/**
 * 쇼츠 씬 2.5D 패럴랙스 — 스틸로 남는 씬의 이미지를 로컬 깊이맵(depth_map.py, Core ML)으로
 * 전경 알파 레이어(fg_NN.png)화. Remotion ParallaxImage 가 전경·배경 시차로 입체감을 만든다.
 * 전량 fail-open(i2vSceneClips 패턴 미러) — 스크립트·모델 실패 시 해당 씬은 켄번즈 유지, 렌더 무중단.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { generateDepthLayers } from '../tools/blog_skills';

export interface SceneDepthLayer { fg: string; bg: string }
export interface SceneDepthResult { layers: Array<SceneDepthLayer | null>; issues: string[] }

// ffmpeg 강제 렌더는 레이어를 못 쓰므로 깊이 계산 자체를 생략(i2vGate 관례 미러).
export const parallaxGate = (): boolean =>
  CONFIG.shortsParallax !== 'off' && CONFIG.shortsRenderer !== 'ffmpeg' && !!CONFIG.blogPython;

/** 매니페스트 파싱(순수) — ok 씬만 fg(전경 누끼)·bg(힐링 배경) 파일명 쌍, 탈락 사유는 issues 로.
 *  파일 실존은 호출부가 검증. bg 는 이중상 방지 — 피사체를 지운 배경이라 전경이 움직여도 사본이 안 보인다. */
export function parseDepthManifest(raw: unknown, count: number): { layers: Array<SceneDepthLayer | null>; issues: string[] } {
  const layers: Array<SceneDepthLayer | null> = Array.from({ length: count }, () => null);
  const issues: string[] = [];
  const scenes = (raw as { scenes?: Array<{ index?: unknown; ok?: unknown; reason?: unknown }> } | null)?.scenes;
  for (const s of scenes ?? []) {
    const i = Math.floor(Number(s?.index));
    if (!Number.isFinite(i) || i < 0 || i >= count) continue;
    const nn = String(i + 1).padStart(2, '0');
    if (s?.ok === true) layers[i] = { fg: `fg_${nn}.png`, bg: `bg_${nn}.png` };
    else if (typeof s?.reason === 'string' && s.reason !== 'no-image') issues.push(`씬${i + 1} ${s.reason}`);
  }
  return { layers, issues };
}

export async function depthSceneLayers(opts: {
  dir: string; images: Array<string | null>; signal?: AbortSignal;
}): Promise<SceneDepthResult> {
  const out: SceneDepthResult = { layers: opts.images.map(() => null), issues: [] };
  try {
    if (!opts.images.some(Boolean)) return out; // 전 씬 클립 — 깊이 계산 불요
    const depthDir = path.join(opts.dir, 'depth');
    fs.mkdirSync(depthDir, { recursive: true });
    const inputsPath = path.join(depthDir, 'inputs.json');
    fs.writeFileSync(inputsPath, JSON.stringify({ images: opts.images }), 'utf-8');
    const r = await generateDepthLayers(inputsPath, depthDir, opts.signal);
    if (!r.ok) { out.issues.push(`깊이맵 실패(켄번즈 유지): ${r.output.slice(-120)}`); return out; }
    const manifest = JSON.parse(fs.readFileSync(path.join(depthDir, 'manifest.json'), 'utf-8')) as unknown;
    const parsed = parseDepthManifest(manifest, opts.images.length);
    out.issues.push(...parsed.issues);
    parsed.layers.forEach((layer, i) => {
      if (!layer) return;
      const fg = path.join(depthDir, layer.fg), bg = path.join(depthDir, layer.bg);
      // 두 파일 모두 실존해야 채택 — 하나라도 없으면 조용히 켄번즈(방어)
      if (fs.existsSync(fg) && fs.existsSync(bg)) out.layers[i] = { fg, bg };
    });
  } catch (e) {
    out.issues.push(`깊이맵 예외(켄번즈 유지): ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  }
  return out;
}
