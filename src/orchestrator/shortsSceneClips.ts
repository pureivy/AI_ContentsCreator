/**
 * 쇼츠 씬 배경 I2V — 씬 QA 통과 이미지를 fal.ai I2V 모델(기본 Wan 2.2 5B)로 모션 클립(mp4)화.
 * 씬별 병렬, 실패 씬은 null(KenBurns 스틸 폴백), 전량 try/catch fail-open — 클립이 없어도
 * 쇼츠는 항상 완성. FAL_KEY 없거나 SHORTS_I2V=off 면 no-op. 씬당 1회·재시도 없음(과금 캡).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { probeDuration } from '../tools/shortsCommon';

export interface SceneClipsResult { clips: Array<string | null>; issues: string[] }

/** 모션 프롬프트 — 씬 프롬프트 + 고정 모션·무텍스트 접미(순수 문자열). */
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
export function buildI2vBody(model: string, prompt: string, imageUrl: string): Record<string, unknown> {
  if (model.includes('wan')) {
    // Wan 2.2: 145프레임@24fps ≈ 6초(Remotion CLIP_FRAMES=180 과 짝), 세로 9:16 명시(입력 2:3 이라 auto 대신 고정).
    return { prompt, image_url: imageUrl, num_frames: 145, frames_per_second: 24, resolution: '720p', aspect_ratio: '9:16' };
  }
  // LTX-2 계열 — 가로 전용(세로 불가 실측). env 로 명시 선택 시에만 사용.
  return { prompt, image_url: imageUrl, duration: 6, resolution: '1080p', fps: 25, generate_audio: false };
}

// ffmpeg 강제 렌더 시 클립을 쓸 수 없으므로 과금 방지 차원에서 스킵.
const gate = (): boolean => CONFIG.shortsI2v === 'fal' && !!CONFIG.falKey && CONFIG.shortsRenderer !== 'ffmpeg';

/** fal queue REST 1회 실행 — 제출→폴링(2초)→결과 JSON. 타임아웃·취소·비정상 응답은 throw. */
async function falQueueRun(model: string, body: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 120_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Key ${CONFIG.falKey}`, 'Content-Type': 'application/json' };
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!sub.ok) throw new Error(`fal 제출 실패 HTTP ${sub.status}`);
  const q = await sub.json() as { status_url?: string; response_url?: string };
  const falHost = (u: string): boolean => { try { const h = new URL(u).host; return h === 'fal.run' || h.endsWith('.fal.run'); } catch { return false; } };
  if (!q.status_url || !q.response_url || !falHost(q.status_url) || !falHost(q.response_url)) throw new Error('fal 큐 응답 이형');
  for (;;) {
    if (signal?.aborted) throw new Error('취소됨');
    if (Date.now() > deadline) throw new Error('fal 타임아웃(120s)');
    let sj: { status?: string } = {};
    try {
      const st = await fetch(q.status_url, { headers, signal });
      sj = await st.json() as { status?: string };
    } catch { /* 일시 오류 — 데드라인까지 폴링 지속(제출 재시도 아님, 과금 불변) */ }
    if (sj.status === 'COMPLETED') break;
    if (sj.status === 'FAILED' || sj.status === 'ERROR') throw new Error(`fal 실패: ${sj.status}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const res = await fetch(q.response_url, { headers, signal });
  if (!res.ok) throw new Error(`fal 결과 조회 실패 HTTP ${res.status}`);
  return res.json();
}

export async function i2vSceneClips(opts: {
  dir: string; images: Array<string | null>; scenePrompts: string[]; signal?: AbortSignal;
}): Promise<SceneClipsResult> {
  const out: SceneClipsResult = { clips: opts.images.map(() => null), issues: [] };
  try {
    if (!gate()) return out;
    const clipsDir = path.join(opts.dir, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });
    await Promise.all(opts.images.map(async (img, i) => {
      if (!img || !fs.existsSync(img)) return;
      try {
        const b64 = fs.readFileSync(img).toString('base64');
        const json = await falQueueRun(CONFIG.shortsI2vModel,
          buildI2vBody(CONFIG.shortsI2vModel, buildMotionPrompt(opts.scenePrompts[i] ?? ''), `data:image/png;base64,${b64}`),
          opts.signal);
        const url = extractVideoUrl(json);
        if (!url) throw new Error('video.url 없음');
        let dl = await fetch(url, { signal: opts.signal });
        if (!dl.ok) dl = await fetch(url, { signal: opts.signal }); // CDN 일시 오류 1회 재시도(생성 재과금 없음)
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
