/**
 * 장면 검사 CLI(에이전트의 ./check.sh 가 부른다) — 빠른 검사 + 타입 검사, 결과 JSON 한 줄. 로직은 src/longform/sceneCheck.ts.
 * 실행: tsx scripts/longform/scene_check.ts <job.json(작업 폴더 밖)> <장면 키 sNNN>
 */
import fs from 'node:fs';
import { checkScene } from '../../src/longform/sceneCheck';
import type { SceneJob } from '../../src/longform/sceneJob';

const [jobPath, key] = process.argv.slice(2);
checkScene(JSON.parse(fs.readFileSync(jobPath!, 'utf8')) as SceneJob, String(key ?? ''))
  .then((r) => { console.log(JSON.stringify(r, null, 1)); })
  .catch((e) => { console.log(JSON.stringify({ ok: false, key, problems: [`검사 실패: ${e instanceof Error ? e.message : String(e)}`] })); process.exitCode = 1; });
