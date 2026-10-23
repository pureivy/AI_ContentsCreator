// 낭독 숫자·단위 읽기 확인(일회성) — pnpm tsx scripts/longform/stt_probe.ts <segId...>
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config';
import { transcribeTake } from '../../src/voice/ttsCheck';
(async () => {
  for (const id of process.argv.slice(2)) {
    const mp3 = fs.readFileSync(path.join(CONFIG.dataDir, 'longform', 'pilot-2026-10-19', 'audio', `${id}.mp3`));
    console.log(id, '→', await transcribeTake(mp3));
  }
})().catch((e) => { console.error(e); process.exit(1); });
