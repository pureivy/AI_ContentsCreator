/**
 * 롱폼 주제 선정 드라이런 — 로컬 데이터(지표·스토어·수요 스냅샷)로 후보 상위를 숫자와 함께 보여 주고, 실제 선정을 한다.
 * 기본은 운영과 같은 LLM 묶음 모드(표준 모델 호출 최대 3번 — 돈이 조금 든다). --no-llm 이면 결정적 선정만(호출 없음).
 * 실행: pnpm tsx scripts/longform/topic.ts [--top 5] [--no-llm]
 */
import { coherenceLlm, defaultTopicDeps, evaluateTopics, fmtViews, selectCoherentTopic, selectTopic } from '../../src/longform/topic';
import { defaultLlmJSON } from '../../src/longform/writer';

const i = process.argv.indexOf('--top');
const top = i > 0 ? Number(process.argv[i + 1]) || 5 : 5;
const d = defaultTopicDeps();
const all = evaluateTopics(d);
console.log(`브랜드 ${d.brand} · 발행 글 ${all.length}편 · 선정 가능 ${all.filter((c) => c.ok).length}편`);
console.log(`\n[조회 합산 상위 ${top}]`);
for (const c of all.slice(0, top)) {
  const p = c.piece;
  console.log(`${String(c.rank).padStart(2)}. ${fmtViews(p.views).padStart(6)} (블로그 ${fmtViews(p.blogViews)} + 숏폼 ${fmtViews(p.shortsViews)}) ${p.topic ?? '-'}:${p.species ?? 'general'} '${p.title}' — ${c.ok ? '선정 가능' : c.why}`);
}
console.log(`\n[선정 가능 상위 ${top}]`);
for (const c of all.filter((x) => x.ok).slice(0, top)) {
  const p = c.piece;
  console.log(`${String(c.rank).padStart(2)}. ${fmtViews(p.views).padStart(6)} ${p.topic}:${p.species ?? 'general'} '${p.title}' + 관련 ${c.related?.length ?? 0}편`);
  for (const q of c.related ?? []) console.log(`      · ${fmtViews(q.views).padStart(6)} ${q.species ?? '-'} '${q.title}'`);
}
const noLlm = process.argv.includes('--no-llm');
const anchor = all.find((c) => c.eligible && (c.pool?.length ?? 0) >= 3);
if (anchor) {
  console.log(`\n[첫 기둥 묶음 후보 풀 — '${anchor.piece.title}' ${anchor.pool!.length}편]`);
  for (const q of anchor.pool!) console.log(`      · ${fmtViews(q.views).padStart(6)} ${q.topic}:${q.species ?? '-'} '${q.title}'`);
}
(async () => {
  const pick = noLlm ? selectTopic(d) : await selectCoherentTopic(d, coherenceLlm(defaultLlmJSON), { log: (m) => console.log(m) });
  console.log(`\n[선정${noLlm ? ' — 결정적(--no-llm)' : ' — LLM 묶음'}] ${pick ? `${pick.topicKey} — ${pick.reason}` : '없음'}`);
  for (const p of pick?.pieces ?? []) console.log(`      · ${p.species ?? '-'} '${p.title}'`);
})().catch((e) => { console.error(e); process.exit(1); });
