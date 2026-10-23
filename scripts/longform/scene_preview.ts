/**
 * 장면 미리보기 CLI(에이전트의 ./preview.sh 가 부른다) — 20%·55%·90% 스틸을 가로로 붙인 preview/<키>.png + 빠른 검사, 결과 JSON.
 * 로직은 src/longform/scenePreview.ts. 실행: tsx scripts/longform/scene_preview.ts <job.json(작업 폴더 밖)> <장면 키 sNNN>
 */
import fs from 'node:fs';
import { previewScene } from '../../src/longform/scenePreview';
import type { SceneJob } from '../../src/longform/sceneJob';

const [jobPath, key] = process.argv.slice(2);
previewScene(JSON.parse(fs.readFileSync(jobPath!, 'utf8')) as SceneJob, String(key ?? ''))
  .then((r) => { console.log(JSON.stringify({ ...r, next: r.image ? `Read 로 ${r.image} 를 열어 본다` : undefined }, null, 1)); })
  .catch((e) => { console.log(JSON.stringify({ ok: false, key, problems: [`미리보기 실패: ${e instanceof Error ? e.message : String(e)}`] })); process.exitCode = 1; });
