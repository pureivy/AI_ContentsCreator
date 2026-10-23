/**
 * 롱폼 시범(2026-10-19)을 롱폼 스토어 1호 레코드로 등록(2026-10-22) — 제작실 롱폼 탭·텔레그램 발행 버튼이
 * 시범 영상을 바로 다루게 한다. 멱등: 같은 id 가 있으면 아무것도 바꾸지 않는다.
 *
 * 돈이 드는 일은 하지 않는다 — 썸네일은 만들지 않고 thumbState 'none' 으로 둔다(제작실·텔레그램의 '썸네일 다시'로 만든다).
 * 올릴 글(제목·설명·태그)은 10-22 정리본(youtube.txt)을 그대로 박아 둔다 — 실행 때 임시 폴더를 읽지 않게.
 *
 * 실행: pnpm tsx scripts/longform/seed_pilot.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { longformStore } from '../../src/content/longform';
import { activeBrandSlug } from '../../src/content/brand';

const ID = 'long_pilot20261019';
const DIR = 'pilot-2026-10-19';
const FPS = 30;

const YT_TITLE = '과일나무 겨울 가지치기 총정리 | 매실·자두·감·블루베리';
const YT_DESCRIPTION = `매실·자두·감·블루베리, 과일나무 겨울 가지치기는 잎이 다 진 뒤에 시작합니다. 수종별 자르는 시기와 자리, 자르면 안 되는 가지까지 10분에 정리했습니다.

챕터
0:00 과일나무 겨울 가지치기, 언제 시작하나
0:43 어린 과일나무 원가지(주지) 3개 고르기
3:55 매실나무 가지치기 시기
4:52 자두나무 높이 낮추기
5:42 감나무 가지치기 시기
7:18 블루베리 묵은 가지 정리
8:21 자르면 안 되는 가지 3가지

#과일나무가지치기 #겨울전정 #매실나무 #감나무 #블루베리`;
const YT_TAGS = ['과일나무가지치기', '겨울전정', '매실나무', '감나무', '블루베리', '자두나무', '가지치기'];

function main(): void {
  const store = longformStore();
  const existing = store.get(ID);
  if (existing) {
    console.log(`이미 있음 — 그대로 둠: ${ID} (stage ${existing.stage}, 유튜브 ${existing.youtubeUrl ?? '미발행'})`);
    return;
  }
  const dir = store.absDir({ dir: DIR });
  if (!dir || !fs.existsSync(path.join(dir, 'final.mp4'))) throw new Error(`시범 영상 없음: ${dir}/final.mp4`);
  const timeline = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf-8')) as { totalFrames?: number };
  const durationSec = Math.round((Number(timeline.totalFrames) || 0) / FPS) || undefined;
  const brand = activeBrandSlug() || 'bionditree';
  const rec = store.create({
    id: ID, dir: DIR, brand, stage: 'ready',
    title: '과일나무 겨울 가지치기 총정리',
    patch: {
      durationSec,
      topicReason: '시범 1호 — 대본·도해를 손으로 만든 편(2026-10-19)',
      ytTitle: YT_TITLE, ytDescription: YT_DESCRIPTION, ytTags: YT_TAGS,
      thumbState: 'none',
    },
  });
  console.log(`등록: ${rec.id} · ${rec.brand} · ${rec.durationSec}초 · ${path.join(dir)}`);
}

main();
