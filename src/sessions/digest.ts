/**
 * 세션 다이제스트 — 런 산출물을 사람이 읽는 마크다운으로 영속화(원본 GEPA sessions/<run_id>/ 패리티).
 *   _brief.md   : 주제 + 하위문제 + 모델 배정
 *   _report.md  : 최종 종합 산출물
 *   <agent>.md  : 에이전트별 산출물
 */
import { mkdir, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import type { FactGateResult } from '../content/factGate';

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

const sessionFile = (runId: string, name: string): string => path.join(CONFIG.sessionsDir, runId, name);
function writeSessionFile(runId: string, name: string, content: string): void {
  fs.mkdirSync(path.join(CONFIG.sessionsDir, runId), { recursive: true });
  fs.writeFileSync(sessionFile(runId, name), content, 'utf-8');
}
/** 리서치 브리프(팀 산출물 종합) — 리비전 런이 같은 근거로 개정하게 영속화(스펙 §3). */
export function writeResearchBrief(runId: string, brief: string): void { writeSessionFile(runId, 'research_brief.md', brief); }
export function readResearchBrief(runId: string): string {
  try { return fs.readFileSync(sessionFile(runId, 'research_brief.md'), 'utf-8'); } catch { return ''; }
}
/** 사실 게이트 결과(스펙 §2-2) — advancePieceReady 가 piece 로 옮긴다. */
export function writeFactGate(runId: string, r: FactGateResult): void { writeSessionFile(runId, 'fact_gate.json', JSON.stringify(r, null, 2)); }
export function readFactGate(runId: string): FactGateResult | null {
  try { return JSON.parse(fs.readFileSync(sessionFile(runId, 'fact_gate.json'), 'utf-8')) as FactGateResult; } catch { return null; }
}
