/**
 * 직접 제작 모션그래픽 파일럿 CLI(2026-10-05) — 본체는 src/orchestrator/shortsDirectMotion.ts(매일 제작에 배선되지 않음).
 * 원본 쇼츠(final.mp4·plan.json·썸네일·저장소 레코드)는 읽기만 하고, data/shorts/<id>/<work>/ 에만 쓴다.
 *
 * 실행:  pnpm exec tsx src/bench/pilotDirect.ts <shortId> [옵션]
 *   --work 폴더         : 출력 폴더 이름(기본 pilot-direct)
 *   --no-styleframes    : 시안 이미지(gpt-image) 생략
 *   --skip-agent        : 이미 있는 scene_NN.html 로 검사·촬영만(에이전트 재실행 없이)
 *   --agent-min N       : 에이전트 시간 상한(분, 기본 30)
 */
import { runDirectMotionPilot } from '../orchestrator/shortsDirectMotion';

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || id.startsWith('--')) throw new Error('사용법: tsx src/bench/pilotDirect.ts <shortId> [--work 폴더] [--no-styleframes] [--skip-agent] [--agent-min N]');
  const argVal = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const mins = Number(argVal('--agent-min'));
  const m = await runDirectMotionPilot({
    id,
    ...(argVal('--work') ? { workName: argVal('--work') } : {}),
    noStyleframes: process.argv.includes('--no-styleframes'),
    skipAgent: process.argv.includes('--skip-agent'),
    ...(mins > 0 ? { agentTimeoutMs: mins * 60_000 } : {}),
  });
  console.log('[결과]', JSON.stringify(m));
  if (!m.out) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
