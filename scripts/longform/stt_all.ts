// 낭독 전수 음성 인식 — 대본과 다르게 들리는 세그먼트 찾기(발음 점검). 결과: stt.json
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config';
import { transcribeTake } from '../../src/voice/ttsCheck';
import type { LongformScript } from '../../src/longform/script';
const OUT = path.join(CONFIG.dataDir, 'longform', process.argv[2] ?? 'pilot-2026-10-19'); // 폴더 이름(기본 시범)
(async () => {
  const script = JSON.parse(fs.readFileSync(path.join(OUT, 'script.json'), 'utf8')) as LongformScript;
  const res: Record<string, { narration: string; heard: string }> = {};
  for (const g of script.chapters.flatMap((c) => c.segments)) {
    const mp3 = fs.readFileSync(path.join(OUT, 'audio', `${g.id}.mp3`));
    res[g.id] = { narration: g.narration, heard: await transcribeTake(mp3).catch((e) => `ERR ${e}`) };
  }
  fs.writeFileSync(path.join(OUT, 'stt.json'), JSON.stringify(res, null, 2));
  console.log('done', Object.keys(res).length);
})();
