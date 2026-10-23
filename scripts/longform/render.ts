/**
 * 롱폼 렌더 CLI — timeline.json → LongForm(별도 진입점) → final.mp4 + srt·report·youtube.txt. 로직은 src/longform/render.ts.
 * 실행: pnpm tsx scripts/longform/render.ts [--dir <폴더 이름, 기본 시범>] [--stills f1,f2,...]   (스틸은 stills/ 에)
 */
import path from 'node:path';
import { defaultRenderDeps, renderEpisode } from '../../src/longform/render';
import { longformRoot, PILOT_DIR_NAME } from '../../src/longform/episode';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT_DIR = path.join(longformRoot(), arg('--dir') ?? PILOT_DIR_NAME);

async function main() {
  const stills = arg('--stills')?.split(',').map(Number).filter((n) => Number.isFinite(n));
  await renderEpisode(OUT_DIR, { deps: await defaultRenderDeps(), ...(stills?.length ? { stills } : {}), log: (m) => console.log(m) });
}

main().catch((e) => { console.error(e); process.exit(1); });
