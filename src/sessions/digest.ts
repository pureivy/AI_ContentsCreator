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
/** 리비전용 브리프 — research_brief.md 가 없으면(이 기능 이전 런) 같은 세션의 work 단계 에이전트 산출물(<id>.md, 첫 줄 "# 이름 (work)")을 이어 붙여 브리프로 쓴다. */
export function readResearchBriefWithFallback(runId: string): string {
  const direct = readResearchBrief(runId);
  if (direct.trim()) return direct;
  try {
    const dir = path.join(CONFIG.sessionsDir, runId);
    const parts: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f.startsWith('_') || f.startsWith('draft')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      const first = text.split('\n')[0] ?? '';
      if (!/\(work\)\s*$/.test(first)) continue;
      parts.push(text.replace(/^# /, '## '));
    }
    return parts.join('\n\n');
  } catch { return ''; }
}
/** 사실 카드(2026-08-26) — 브리프에서 근거 확인된 사실만 압축한 카드. 리비전 런이 같은 카드를 재사용하게 영속화. */
export function writeFactCard(runId: string, card: string): void { writeSessionFile(runId, 'fact_card.md', card); }
export function readFactCard(runId: string): string {
  try { return fs.readFileSync(sessionFile(runId, 'fact_card.md'), 'utf-8'); } catch { return ''; }
}
/** 사실 게이트 결과(스펙 §2-2) — advancePieceReady 가 piece 로 옮긴다. */
export function writeFactGate(runId: string, r: FactGateResult): void { writeSessionFile(runId, 'fact_gate.json', JSON.stringify(r, null, 2)); }
export function readFactGate(runId: string): FactGateResult | null {
  try { return JSON.parse(fs.readFileSync(sessionFile(runId, 'fact_gate.json'), 'utf-8')) as FactGateResult; } catch { return null; }
}
