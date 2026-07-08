/**
 * 쇼츠 씬 배경 I2V — 씬 QA 통과 이미지를 fal.ai I2V 모델(기본 LTX-2 fast)로 모션 클립(mp4)화.
 * 씬별 병렬, 실패 씬은 null(KenBurns 스틸 폴백), 전량 try/catch fail-open — 클립이 없어도
 * 쇼츠는 항상 완성. FAL_KEY 없거나 SHORTS_I2V=off 면 no-op. 씬당 1회·재시도 없음(과금 캡).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface SceneClipsResult { clips: Array<string | null>; issues: string[] }

/** 모션 프롬프트 — 씬 프롬프트 + 고정 모션·무텍스트 접미(순수 문자열). */
export function buildMotionPrompt(scenePrompt: string): string {
  return `${scenePrompt} subtle cinematic motion, slow camera drift, natural ambient movement, no text, no captions.`;
}

/** fal 응답에서 video.url 안전 추출(순수) — http(s) 문자열이 아니면 null. */
export function extractVideoUrl(json: unknown): string | null {
  const v = (json as { video?: { url?: unknown } } | null)?.video?.url;
  return typeof v === 'string' && v.startsWith('http') ? v : null;
}

const gate = (): boolean => CONFIG.shortsI2v === 'fal' && !!CONFIG.falKey;

/** fal queue REST 1회 실행 — 제출→폴링(2초)→결과 JSON. 타임아웃·취소·비정상 응답은 throw. */
async function falQueueRun(model: string, body: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 120_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const headers = { Authorization: `Key ${CONFIG.falKey}`, 'Content-Type': 'application/json' };
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!sub.ok) throw new Error(`fal 제출 실패 HTTP ${sub.status}`);
  const q = await sub.json() as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url) throw new Error('fal 큐 응답 이형');
  for (;;) {
    if (signal?.aborted) throw new Error('취소됨');
    if (Date.now() > deadline) throw new Error('fal 타임아웃(120s)');
    const st = await fetch(q.status_url, { headers, signal });
    const sj = await st.json() as { status?: string };
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
        const json = await falQueueRun(CONFIG.shortsI2vModel, {
          prompt: buildMotionPrompt(opts.scenePrompts[i] ?? ''),
          image_url: `data:image/png;base64,${b64}`,
          duration: 6, resolution: '1080p', fps: 25, generate_audio: false,
        }, opts.signal);
        const url = extractVideoUrl(json);
        if (!url) throw new Error('video.url 없음');
        const dl = await fetch(url, { signal: opts.signal });
        if (!dl.ok) throw new Error(`클립 다운로드 실패 HTTP ${dl.status}`);
        const fp = path.join(clipsDir, `clip_${String(i + 1).padStart(2, '0')}.mp4`);
        fs.writeFileSync(fp, Buffer.from(await dl.arrayBuffer()));
        out.clips[i] = fp;
      } catch (e) {
        out.issues.push(`씬${i + 1} I2V 실패(스틸 폴백): ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
    }));
  } catch { /* fail-open — 전 씬 스틸 */ }
  return out;
}
