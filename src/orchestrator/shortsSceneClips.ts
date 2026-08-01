/**
 * 쇼츠 씬 배경 I2V — 씬 QA 통과 이미지를 fal.ai I2V 모델(기본 Wan 2.2 5B)로 모션 클립(mp4)화.
 * 씬별 병렬, 실패 씬은 null(KenBurns 스틸 폴백), 전량 try/catch fail-open — 클립이 없어도
 * 쇼츠는 항상 완성. FAL_KEY 없거나 SHORTS_I2V=off 면 no-op. 씬당 1회·재시도 없음(과금 캡).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { probeDuration } from '../tools/shortsCommon';
import { hasSubjectRisk } from './shortsMotionDirector';

export interface SceneClipsResult { clips: Array<string | null>; issues: string[] }

/** 모션 프롬프트(정적 폴백) — 씬 프롬프트 + 고정 모션·무텍스트 접미(순수 문자열).
 *  기본 경로는 모션 디렉터(shortsMotionDirector)가 이미지를 보고 쓴 씬별 프롬프트이고,
 *  비전 실패·누락 씬만 이 정적 접미로 강등된다. */
export function buildMotionPrompt(scenePrompt: string): string {
  return `${scenePrompt} subtle cinematic motion, slow camera drift, natural ambient movement, no text, no captions.`;
}

/** fal 응답에서 video.url 안전 추출(순수) — http(s) 문자열이 아니면 null. */
export function extractVideoUrl(json: unknown): string | null {
  const v = (json as { video?: { url?: unknown } } | null)?.video?.url;
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : null;
}

/**
 * 모델별 요청 body(순수) — LTX 계열과 Wan 계열은 파라미터 스키마가 달라 비호환 필드는 422 로
 * 무음 실패한다(실런 검증: LTX-2 는 aspect 파라미터가 없어 가로 전용 → 세로 쇼츠 기본은 Wan).
 */
export function buildI2vBody(model: string, prompt: string, imageUrl: string, subjectHold = false): Record<string, unknown> {
  if (model.includes('wan')) {
    // Wan 2.2: 145프레임@24fps ≈ 6초(Remotion CLIP_FRAMES=180 과 짝), 세로 9:16 명시(입력 2:3 이라 auto 대신 고정).
    // negative_prompt: 5B 급 대표 붕괴(형태 용융·손 기형·물체 출현/소실·유사 글자) 억제 — fal Wan 스키마 표준 필드.
    // subjectHold(사람·손·도구 씬 카메라 전용 강제)면 피사체 동작 자체를 negative 로 눌러 모델 단에서도 이중 방어.
    return {
      prompt, image_url: imageUrl, num_frames: 145, frames_per_second: 24, resolution: '720p', aspect_ratio: '9:16',
      negative_prompt: 'distortion, morphing, warping, melting, deformed face, deformed hands, extra limbs, mutated fingers, objects appearing or disappearing, text, letters, watermark, flickering'
        + (subjectHold ? ', hands moving, fingers moving, arms moving, people moving, person walking, gesturing, grabbing, cutting motion, tool moving, action progressing' : ''),
    };
  }
  // LTX-2 계열 — 가로 전용(세로 불가 실측). env 로 명시 선택 시에만 사용(negative_prompt 필드 없음).
  return { prompt, image_url: imageUrl, duration: 6, resolution: '1080p', fps: 25, generate_audio: false };
}

// ffmpeg 강제 렌더 시 클립을 쓸 수 없으므로 과금 방지 차원에서 스킵.
// export — 호출부(shorts.ts)가 모션 디렉터 비전 호출 전 같은 게이트로 낭비를 막는다.
export const i2vGate = (): boolean => CONFIG.shortsI2v === 'fal' && !!CONFIG.falKey && CONFIG.shortsRenderer !== 'ffmpeg';

// I2V 폴링 타임아웃 — 제출 후 결과 대기(폴링 연장은 재제출/재과금 아님, '과금 불변'). fal 큐 혼잡 시 120s는
// 잦은 타임아웃→스틸 폴백(모션 상실)이라 180s 로 완화해 느린 생성을 회수. 재시도는 여전히 없음(과금 캡 유지).
const I2V_TIMEOUT_MS = 180_000;

/** fal queue REST 1회 실행 — 제출→폴링(2초)→결과 JSON. 타임아웃·취소·비정상 응답은 throw.
 *  중단 시 서버측 잡도 취소(cancel_url PUT, fire-and-forget) — 과금 즉시 종료. */
async function falQueueRun(model: string, body: Record<string, unknown>, signal?: AbortSignal, timeoutMs = I2V_TIMEOUT_MS): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Key ${CONFIG.falKey}`, 'Content-Type': 'application/json' };
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!sub.ok) throw new Error(`fal 제출 실패 HTTP ${sub.status}`);
  const q = await sub.json() as { status_url?: string; response_url?: string; cancel_url?: string };
  const falHost = (u: string): boolean => { try { const h = new URL(u).host; return h === 'fal.run' || h.endsWith('.fal.run'); } catch { return false; } };
  if (!q.status_url || !q.response_url || !falHost(q.status_url) || !falHost(q.response_url)) throw new Error('fal 큐 응답 이형');
  const cancel = (): void => {
    if (q.cancel_url && falHost(q.cancel_url)) void fetch(q.cancel_url, { method: 'PUT', headers }).catch(() => { /* 취소 실패 무해 */ });
  };
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('취소됨');
      if (Date.now() > deadline) throw new Error(`fal 타임아웃(${Math.round(timeoutMs / 1000)}s)`);
      let sj: { status?: string } = {};
      try {
        const st = await fetch(q.status_url, { headers, signal });
        sj = await st.json() as { status?: string };
      } catch { /* 일시 오류 — 데드라인까지 폴링 지속(제출 재시도 아님, 과금 불변) */ }
      if (sj.status === 'COMPLETED') break;
      if (sj.status === 'FAILED' || sj.status === 'ERROR') throw new Error(`fal 실패: ${sj.status}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) { cancel(); throw e; }
  const res = await fetch(q.response_url, { headers, signal });
  if (!res.ok) throw new Error(`fal 결과 조회 실패 HTTP ${res.status}`);
  return res.json();
}

export async function i2vSceneClips(opts: {
  dir: string; images: Array<string | null>; scenePrompts: string[];
  /** 모션 디렉터(비전)가 쓴 씬별 프롬프트 — null/누락 씬은 buildMotionPrompt 정적 접미로 폴백. */
  motionPrompts?: Array<string | null>;
  /** 비전이 '사람·손·도구 있음'으로 판정한 씬 인덱스 — I2V 를 건너뛰고 스틸로 남긴다. */
  subjectScenes?: Set<number>;
  signal?: AbortSignal;
}): Promise<SceneClipsResult> {
  const out: SceneClipsResult = { clips: opts.images.map(() => null), issues: [] };
  try {
    if (!i2vGate()) return out;
    const clipsDir = path.join(opts.dir, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });
    await Promise.all(opts.images.map(async (img, i) => {
      if (!img || !fs.existsSync(img)) return;
      try {
        const sceneSignal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(I2V_TIMEOUT_MS)]) : AbortSignal.timeout(I2V_TIMEOUT_MS);
        const scenePrompt = opts.scenePrompts[i] ?? '';
        const directed = opts.motionPrompts?.[i];
        // 사람·손·도구 씬은 I2V 자체를 건너뛴다(사용자 확정 2026-08-01). 카메라 전용 프롬프트 + 동작 금지
        // negative 를 모두 넣어도 5B 모델이 무시해 손가락·도구가 뒤틀린다(실측: 그렇게 보낸 씬에서 클립 QA 가
        // '손가락이 비정상적으로 붙어 형태가 왜곡됨' 검출). 프롬프트로 '부탁'하는 대신 구조로 차단 —
        // 이 씬은 클립 없이 스틸(켄번즈)로 렌더된다. 판별: 비전 분류(마커) 또는 장면 묘사 키워드.
        if (opts.subjectScenes?.has(i) || (directed?.startsWith('Camera work only:') ?? false) || hasSubjectRisk(scenePrompt)) {
          out.issues.push(`씬${i + 1} 사람·손·도구 — I2V 생략(스틸 유지)`);
          return;
        }
        const b64 = fs.readFileSync(img).toString('base64');
        const motion = directed ?? buildMotionPrompt(scenePrompt);
        const json = await falQueueRun(CONFIG.shortsI2vModel,
          buildI2vBody(CONFIG.shortsI2vModel, motion, `data:image/png;base64,${b64}`),
          sceneSignal);
        const url = extractVideoUrl(json);
        if (!url) throw new Error('video.url 없음');
        let dl = await fetch(url, { signal: sceneSignal });
        if (!dl.ok) dl = await fetch(url, { signal: sceneSignal }); // CDN 일시 오류 1회 재시도(생성 재과금 없음)
        if (!dl.ok) throw new Error(`클립 다운로드 실패 HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.length < 10_000) throw new Error(`클립 데이터 이상(${buf.length}B)`);
        const fp = path.join(clipsDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
        fs.writeFileSync(fp, buf);
        await probeDuration(fp); // 손상 mp4 거부 — 그 씬만 스틸 폴백(전체 렌더 강등 방지)
        out.clips[i] = fp;
      } catch (e) {
        out.issues.push(`씬${i + 1} I2V 실패(스틸 폴백): ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
    }));
  } catch { /* fail-open — 전 씬 스틸 */ }
  return out;
}
