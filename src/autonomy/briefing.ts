/**
 * 일일 브리핑 — 조직의 하루 활동 다이제스트(Connect AI 모닝 브리핑 대응). LLM 없이 기존 데이터만으로 구성:
 * 위키 현황 · 최근 결정(decisions.md) · 최근 학습(lesson 페이지) · 대기 승인. 알림 채널로 전송된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { llmWiki } from '../wiki/llmwiki';
import { approvalStore } from '../approvals/store';
import type { NotifyMessage } from './notify';

function readTail(p: string, max: number): string {
  try {
    const t = fs.readFileSync(p, 'utf-8').trim();
    return t.length > max ? '…\n' + t.slice(-max) : t;
  } catch {
    return '';
  }
}

/** 순수 — 수집된 섹션을 브리핑 메시지로 조립(테스트 용이). 빈 섹션은 제외. */
export function composeBriefing(date: string, sections: Array<{ heading: string; body: string }>): NotifyMessage {
  const body =
    sections.filter((s) => s.body.trim()).map((s) => `${s.heading}\n${s.body.trim()}`).join('\n\n') ||
    '오늘 기록된 특별한 활동이 없습니다.';
  return { title: `📋 일일 브리핑 · ${date}`, body };
}

/** 실제 데이터(위키·결정·학습·승인)에서 일일 브리핑을 구성. */
export function buildBriefing(): NotifyMessage {
  const date = new Date().toISOString().slice(0, 10);
  const sections: Array<{ heading: string; body: string }> = [];
  try {
    const w = llmWiki().stats();
    sections.push({ heading: '📚 지식베이스', body: `${w.pages}페이지 (개념 ${w.concepts} · 소스 ${w.sources} · 링크 ${w.links})` });
  } catch { /* 위키 없음 무해 */ }
  const dec = readTail(path.join(CONFIG.dataDir, '_shared', 'decisions.md'), 1200);
  if (dec) sections.push({ heading: '⚖️ 최근 결정', body: dec });
  try {
    const lessons = llmWiki().list('lesson').slice(0, 5).map((p) => `- ${p.summary || p.title}`).join('\n');
    if (lessons) sections.push({ heading: '🎓 최근 학습', body: lessons });
  } catch { /* */ }
  try {
    const n = approvalStore().list().length;
    if (n > 0) sections.push({ heading: '🔔 대기 승인', body: `${n}건 — 결재 대기 중` });
  } catch { /* */ }
  return composeBriefing(date, sections);
}
