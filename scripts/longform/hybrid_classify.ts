/**
 * 혼합(H) 롱폼 견본 — 문장 갈래 나누기(2026-10-23, 옵트인 견본·본편 기본값 아님).
 * 세그먼트마다 card(정보 카드)|diagram(연필 도해)|footage(실촬영 전체 화면) 하나를 LLM 한 번으로 고르고 사유를 단다.
 * 사장님 규칙: 목록·비교·순서·숫자/범위·기준 = card, 카메라로 못 보는 구조(땅속 뿌리·접목부 단면·저장 양분·언 흙층·지도/지역) = diagram,
 * 이야기·그 밖 = footage. 대략 1/3 씩이되 내용 우선, 장마다 footage 최소 하나. 손·껍질 위주 구도는 키트 수리 중이라 diagram 에서 뺀다.
 * 실행: tsx scripts/longform/hybrid_classify.ts <편 폴더> [--model standard|heavy]
 * 결과: <편 폴더>/types.json — { segments: [{ id, chapter, narration, type, reason, by }], model, costUsd }
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config';
import { agentEnv, runProc } from '../../src/orchestrator/cliProc';
import type { Timeline } from '../../src/longform/timeline';

export type HybridType = 'card' | 'diagram' | 'footage';
export interface TypedSeg { id: string; chapter: string; narration: string; type: HybridType; reason: string; by: 'llm' | 'rule' }

const [dirArg] = process.argv.slice(2);
if (!dirArg) throw new Error('사용법: hybrid_classify.ts <편 폴더> [--model standard|heavy]');
const dir = path.resolve(dirArg);
const mi = process.argv.indexOf('--model');
const tier = (mi > 0 ? process.argv[mi + 1] : 'standard') as 'standard' | 'heavy';
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;

const prompt = [
  '나무 정원 유튜브 롱폼(가로 16:9) 낭독 문장마다 화면 갈래를 하나씩 고른다. 질문하지 말고 JSON 만 답한다.',
  '',
  '[갈래]',
  '- card: 정보 문장 — 목록(셋 이상 나열), 비교(A vs B, 틀림→맞음), 순서·단계, 숫자·범위(6~14m, 11월, 1~3년생), 판단 기준. 숏폼 같은 유리 카드(알약 줄·번호·✕/✓·화살표·숫자 강조)로 보여 준다. 카드 글자는 그 문장의 말만 쓸 수 있으니 문장 안에 카드로 뽑을 낱말이 실제로 있어야 한다.',
  '- diagram: 카메라로 찍을 수 없는 구조 — 땅속 뿌리, 접붙인 자리 단면, 몸통 속 저장 양분, 언 흙층, 지도·지역. 연필 선화 도해로 그린다. 단, 손으로 쥐기·만지기, 나무껍질 질감 위주 구도는 도해 키트가 수리 중이라 고르지 않는다.',
  '- footage: 이야기·도입·맺음·분위기 문장, 또는 위 둘에 딱 맞지 않는 문장. 주인공 수종(감나무) 실촬영을 화면 가득 보여 준다.',
  '',
  '[배분] 대략 1/3 씩을 목표로 하되 내용을 따른다. 장(chapter)마다 footage 가 최소 하나. 같은 갈래가 셋 넘게 연달아 이어지지 않게.',
  '',
  '[문장]',
  ...tl.segments.map((s) => `- ${s.id} (장: ${s.chapterTitle}) ${s.narration}`),
  '',
  '[답] JSON 배열 한 줄만: [{"id":"intro-01","type":"footage","reason":"한국어 한 줄 사유"}, …] — 모든 문장, 순서대로.',
].join('\n');

const t0 = Date.now();
const model = CONFIG.cloudTierModels[tier];
const r = await runProc(CONFIG.claudeCliPath, ['-p', '--model', model, '--setting-sources', '', '--no-session-persistence', '--max-turns', '1', '--tools', '', '--output-format', 'json'],
  { env: agentEnv(process.env), timeoutMs: 5 * 60_000, stdin: prompt });
const out = JSON.parse(r.stdout || '{}') as { result?: string; total_cost_usd?: number };
const text = out.result ?? '';
const m = /\[[\s\S]*\]/.exec(text);
if (!m) throw new Error(`분류 응답에서 JSON 을 못 찾음 (exit ${r.code}): ${text.slice(0, 300)} ${r.stderr.slice(-300)}`);
const ans = JSON.parse(m[0]) as Array<{ id: string; type: string; reason: string }>;
const byId = new Map(ans.map((a) => [a.id, a]));

const segs: TypedSeg[] = tl.segments.map((s) => {
  const a = byId.get(s.id);
  const type: HybridType = a && (a.type === 'card' || a.type === 'diagram' || a.type === 'footage') ? a.type : 'footage';
  return { id: s.id, chapter: s.chapter, narration: s.narration, type, reason: a?.reason ?? '응답 없음 — footage 로', by: a ? 'llm' : 'rule' };
});
// 사후 규칙 — 손 구도는 도해 금지(키트 수리 중), 장마다 footage 하나 이상.
for (const s of segs) {
  if (s.type === 'diagram' && /손에|손으로|쥐|만져/.test(s.narration)) { s.type = 'card'; s.reason = `규칙: 손 구도라 도해 대신 카드(원래 사유: ${s.reason})`; s.by = 'rule'; }
}
for (const ch of [...new Set(segs.map((s) => s.chapter))]) {
  const mine = segs.filter((s) => s.chapter === ch);
  if (mine.some((s) => s.type === 'footage')) continue;
  // 정보 낱말(숫자·나열)이 가장 적은 문장을 footage 로.
  const info = (t: string) => (t.match(/\d|,|·|~/g) ?? []).length;
  const pick = [...mine].sort((a, b) => info(a.narration) - info(b.narration))[0]!;
  pick.reason = `규칙: 장마다 실촬영 하나(원래 ${pick.type} — ${pick.reason})`; pick.type = 'footage'; pick.by = 'rule';
}
const count = (t: HybridType) => segs.filter((s) => s.type === t).length;
fs.writeFileSync(path.join(dir, 'types.json'), JSON.stringify({ at: new Date().toISOString(), model, costUsd: out.total_cost_usd ?? null, durationSec: Math.round((Date.now() - t0) / 1000), segments: segs }, null, 2));
console.log(`[갈래] card ${count('card')} · diagram ${count('diagram')} · footage ${count('footage')} · $${(out.total_cost_usd ?? 0).toFixed(3)} · ${model}`);
for (const s of segs) console.log(`  ${s.id.padEnd(13)} ${s.type.padEnd(8)} ${s.by === 'rule' ? '(규칙) ' : ''}${s.reason}`);
