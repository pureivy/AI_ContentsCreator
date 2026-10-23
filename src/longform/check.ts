/**
 * 롱폼 대본 검사 — validateScript(결정적) + factGateBlog(원문 근거, 선택). script.txt 를 함께 쓴다.
 * 시범 CLI(scripts/longform/check.ts)와 제작 파이프라인(orchestrator/longform.ts)이 같은 함수를 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { factGateBlog, type FactGateResult } from '../content/factGate';
import { loadSources } from './source';
import { scriptChars, validateScript, type LongformScript } from './script';
import { loadEpisodeScript, scriptText } from './episode';

export interface CheckResult {
  issues: string[];
  chars: number;
  segments: number;
  /** 사실 확인을 돌렸을 때만. */
  gate?: { status: FactGateResult['status']; unsupported: string[]; contradicted: string[] };
}

/** 원문 합본(근거) — 대본 sourcePieceIds 순서. */
export async function episodeSourceText(s: LongformScript, dataDir = CONFIG.dataDir): Promise<string> {
  const sources = await loadSources(s.sourcePieceIds ?? undefined, dataDir);
  return sources.map((x) => x.body).join('\n\n');
}

export async function checkEpisode(dir: string, opts: {
  gate?: boolean; model?: string; signal?: AbortSignal; dataDir?: string; script?: LongformScript; sourceText?: string;
  factGate?: typeof factGateBlog;
} = {}): Promise<CheckResult> {
  const script = opts.script ?? loadEpisodeScript(dir);
  const sourceText = opts.sourceText ?? await episodeSourceText(script, opts.dataDir);
  const issues = validateScript(script, sourceText);
  const segs = script.chapters.flatMap((c) => c.segments);
  fs.writeFileSync(path.join(dir, 'script.txt'), scriptText(script));
  const out: CheckResult = { issues, chars: scriptChars(script), segments: segs.length };
  if (opts.gate) {
    const gate = opts.factGate ?? factGateBlog;
    const r = await gate({
      model: opts.model ?? CONFIG.cloudTierModels.standard, body: segs.map((g) => g.narration).join('\n'),
      evidence: sourceText, maxClaims: 80, strict: true, signal: opts.signal,
    });
    out.gate = { status: r.status, unsupported: r.unsupported, contradicted: r.contradicted };
  }
  return out;
}
