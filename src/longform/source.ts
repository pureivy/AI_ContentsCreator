/**
 * 롱폼 원문 수집 — 발행 본문(sessions/<runId>/05_final_content.json)을 주어진 글 순서대로 읽는다.
 * 시범(2026-10-19)은 SOURCE_PIECES 고정 목록, 새 편은 주제 선정(topic.ts)이 고른 글 id(대본 sourcePieceIds).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

/** 시범 설계 원재료 표 순서(뼈대·매실·자두·감·블루베리·마무리). */
export const SOURCE_PIECES = [
  'piece_d407adc08b', 'piece_31594d63b7', 'piece_1b2f95327b', 'piece_cd23a28fee', 'piece_5c1d9ebb2f', 'piece_618c36fffe',
] as const;

export interface SourcePiece { pieceId: string; title: string; body: string }

/** 세션의 발행 본문(제목 + 소제목·본문 이어 붙임). 파일이 없거나 형식이 다르면 null. */
export function readFinalBody(runId: string, sessionsDir = path.join(CONFIG.dataDir, 'sessions')): { title: string; body: string } | null {
  try {
    const final = JSON.parse(fs.readFileSync(path.join(sessionsDir, runId, '05_final_content.json'), 'utf8'));
    const t = final?.smarteditor_text as { title?: string; sections?: Array<{ heading?: string; body?: string }> } | undefined;
    if (!t || !Array.isArray(t.sections)) return null;
    const body = t.sections.map((s) => [s.heading, s.body].filter(Boolean).join('\n')).join('\n\n');
    return body.trim() ? { title: t.title ?? '', body } : null;
  } catch { return null; }
}

export async function loadSources(pieceIds: readonly string[] = SOURCE_PIECES, dataDir = CONFIG.dataDir): Promise<SourcePiece[]> {
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'pieces', 'index.json'), 'utf8')) as Array<{ id: string; title: string; runId: string }>;
  const out: SourcePiece[] = [];
  for (const id of pieceIds) {
    const p = index.find((x) => x.id === id);
    if (!p) throw new Error(`글 없음: ${id}`);
    const f = p.runId ? readFinalBody(p.runId, path.join(dataDir, 'sessions')) : null;
    if (!f) throw new Error(`발행 본문 없음: ${id} (sessions/${p.runId}/05_final_content.json)`);
    out.push({ pieceId: id, title: f.title || p.title, body: f.body });
  }
  return out;
}
