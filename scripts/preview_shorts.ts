/**
 * 디자인 미리보기 렌더 — sampleProps(연출 전종) 로 AutoShorts 를 통째로 뽑는다.
 *
 * 실파생은 대본 생성(LLM)과 낭독(ElevenLabs)이 앞에 붙어 돈이 든다. 그런데 카드 배치·자막
 * 크기·등장 애니메이션처럼 눈으로 봐야 아는 것들은 그 앞단이 전혀 필요 없다. 이 스크립트는
 * 실렌더와 똑같은 컴포지션·똑같은 RENDER_OPTS 로 돌려서, 화면만 공짜로 확인하게 해 준다.
 *
 *   pnpm preview                 → out/preview.mp4
 *   pnpm preview 내경로.mp4       → 지정 경로
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { RENDER_OPTS } from '../src/tools/shortsRenderRemotion';
import { sampleProps } from '../remotion/sampleProps';

async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? 'out/preview.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const work = path.join(path.dirname(out), '.preview-bundle');

  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), outDir: work });
  console.log(`번들 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const composition = await selectComposition({ serveUrl, id: 'AutoShorts', inputProps: sampleProps });
  console.log(`컴포지션 ${composition.width}x${composition.height} · ${composition.durationInFrames}프레임 · ${composition.fps}fps`);

  let last = -1;
  const t1 = Date.now();
  await renderMedia({
    serveUrl, composition, codec: 'h264', outputLocation: out, inputProps: sampleProps, ...RENDER_OPTS,
    onProgress: ({ progress }) => {
      const p = Math.floor(progress * 10) * 10;
      if (p > last) { last = p; console.log(`렌더 ${p}%`); }
    },
  });
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`완료 ${((Date.now() - t1) / 1000).toFixed(1)}s → ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)}MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
