/**
 * 전체 화면 장면 검사 CLI(에이전트의 ./check.sh 가 부른다 — 2026-10-23 견본, 옵트인). 로직은 src/longform/sceneFull.ts.
 * 실행: tsx scripts/longform/scene_check_full.ts <job.json(작업 폴더 밖)> <장면 키 sNNN>
 */
import fs from 'node:fs';
import { checkSceneFull } from '../../src/longform/sceneFull';
import type { SceneJob } from '../../src/longform/sceneJob';

const [jobPath, key] = process.argv.slice(2);
checkSceneFull(JSON.parse(fs.readFileSync(jobPath!, 'utf8')) as SceneJob, String(key ?? ''))
  .then((r) => { console.log(JSON.stringify(r, null, 1)); })
  .catch((e) => { console.log(JSON.stringify({ ok: false, key, problems: [`검사 실패: ${e instanceof Error ? e.message : String(e)}`] })); process.exitCode = 1; });
