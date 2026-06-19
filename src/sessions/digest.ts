/**
 * 세션 다이제스트 — 런 산출물을 사람이 읽는 마크다운으로 영속화(원본 GEPA sessions/<run_id>/ 패리티).
 *   _brief.md   : 주제 + 하위문제 + 모델 배정
 *   _report.md  : 최종 종합 산출물
 *   <agent>.md  : 에이전트별 산출물
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config';

export interface AgentOutput {
  id: string;
  name: string;
  stage: string;
  text: string;
}

export interface DigestInput {
  runId: string;
  topic: string;
  subproblems: Array<{ id: string; text: string }>;
  modelAssignmentReason: string;
  agentOutputs: AgentOutput[];
  deliverable: string;
}

export async function writeDigest(d: DigestInput): Promise<string> {
  const dir = path.join(CONFIG.sessionsDir, d.runId);
  await mkdir(dir, { recursive: true });

  const brief =
    `# 브리프 — ${d.topic}\n\n` +
    `- run: \`${d.runId}\`\n- 모델 배정: ${d.modelAssignmentReason}\n\n` +
    `## 하위 문제\n${d.subproblems.map((s) => `- (${s.id}) ${s.text}`).join('\n')}\n`;
  await writeFile(path.join(dir, '_brief.md'), brief, 'utf-8');

  await writeFile(
    path.join(dir, '_report.md'),
    `# 최종 종합 — ${d.topic}\n\n${d.deliverable}\n`,
    'utf-8',
  );

  await Promise.all(
    d.agentOutputs.map((a) =>
      writeFile(
        path.join(dir, `${a.id}.md`),
        `# ${a.name} (${a.stage})\n\n${a.text}\n`,
        'utf-8',
      ),
    ),
  );

  return dir;
}
