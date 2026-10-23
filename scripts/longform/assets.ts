/**
 * 롱폼 자산 CLI — 세그먼트 낭독(mp3) → 영상 구간 배정 → 클립 자르기 → timeline.json. 로직은 src/longform/assets.ts.
 * 이미 만든 mp3·클립은 다시 만들지 않는다(재실행 비용 0). 시범 CLI 는 문장 바꿔 쓰기(LLM)를 하지 않는다.
 * 실행: pnpm tsx scripts/longform/assets.ts [--dir <폴더 이름, 기본 시범>] [--only <장 id>] [--retake id1,id2]
 */
import path from 'node:path';
import { assembleTimeline, defaultAssetDeps, synthesizeAll } from '../../src/longform/assets';
import { loadEpisodeScript, loadMediaVideos, longformRoot, PILOT_DIR_NAME } from '../../src/longform/episode';
import { CHAPTER_CARD_SEC, GAP_SEC } from '../../src/longform/timeline';
import { scriptChars } from '../../src/longform/script';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT_DIR = path.join(longformRoot(), arg('--dir') ?? PILOT_DIR_NAME);

async function main() {
  const only = arg('--only') ?? undefined;
  const retake = new Set((arg('--retake') ?? '').split(',').filter(Boolean));
  const deps = await defaultAssetDeps();
  const r = await synthesizeAll(OUT_DIR, loadEpisodeScript(OUT_DIR), { deps, only, retake, log: (m) => console.log(m) });
  console.log(`[낭독] 이번 실행 ElevenLabs 글자 ${r.ttsChars}`);
  const flat = r.script.chapters.flatMap((c) => c.segments.map((g) => ({ ...g, chapter: c.id })));

  if (only) {
    const segs = flat.filter((g) => g.chapter === only);
    const chars = segs.reduce((n, g) => n + g.narration.replace(/\s/g, '').length, 0);
    const speech = segs.reduce((n, g) => n + r.durations[g.id]!, 0);
    const cps = chars / speech;
    const est = scriptChars(r.script) / cps + flat.length * GAP_SEC + r.script.chapters.length * CHAPTER_CARD_SEC;
    console.log(`[실측] ${only}: ${chars}자 / ${speech.toFixed(1)}초 = ${cps.toFixed(2)}자/초 → 전체 추정 ${est.toFixed(0)}초`);
    console.log(`[실측] 600초에 필요한 글자 ≈ ${Math.round((600 - flat.length * GAP_SEC - r.script.chapters.length * CHAPTER_CARD_SEC) * cps)}`);
    return;
  }
  // 시범은 브랜드를 거르지 않는다 — 시범 클립 배정이 예전과 같게(새 편은 오케스트레이터가 브랜드로 거른다).
  const media = loadMediaVideos();
  console.log(`[보관소] 영상 후보 ${media.length}`);
  await assembleTimeline(OUT_DIR, r.script, r.durations, media, { deps, log: (m) => console.log(m) });
}

main().catch((e) => { console.error(e); process.exit(1); });
