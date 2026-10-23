/**
 * 롱폼 주제 선정 드라이런 — 로컬 데이터(지표·스토어·수요 스냅샷)로 후보 상위를 숫자와 함께 보여 주고, 실제 선정을 한다.
 * 기본은 운영과 같은 LLM 묶음 모드(표준 모델 호출 최대 3번 — 돈이 조금 든다). --no-llm 이면 결정적 선정만(호출 없음).
 * --compare 면 views(조회 합산)와 v2(블로그 하루 조회 × 제철 앞당김 × 판매) 두 방식의 상위 후보를 점수 근거와 함께 나란히 보여 주고 끝낸다
 * (LLM 호출 없음 — 묶음 일관성 단계는 빼고 결정적 선정만). --at 으로 기준 시각을 바꾼다(예: 다음 오토런 2026-10-27T00:00:00+09:00).
 * 실행: pnpm tsx scripts/longform/topic.ts [--top 5] [--no-llm] [--compare] [--at ISO]
 */
import { coherenceLlm, defaultTopicDeps, evaluateTopics, fmtPerDay, fmtViews, selectCoherentTopic, selectTopic, topicLabel, type TopicDeps } from '../../src/longform/topic';
import { defaultLlmJSON } from '../../src/longform/writer';
import type { TopicMode } from '../../src/config';

const arg = (k: string): string | undefined => { const j = process.argv.indexOf(k); return j > 0 ? process.argv[j + 1] : undefined; };
const top = Number(arg('--top')) || 5;
const at = arg('--at');
const d = defaultTopicDeps(at ? new Date(at) : new Date());

if (process.argv.includes('--compare')) {
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const row = (c: ReturnType<typeof evaluateTopics>[number], i: number) => {
    const p = c.piece, v = p.v2!;
    const judge = c.ok ? `10분 가능(관련 ${c.related?.length ?? 0})` : c.eligible ? `짧은 편 후보(관련 ${c.related?.length ?? 0})` : c.why;
    return `| ${i} | ${v.score.toFixed(2)} | ${fmtPerDay(v.perDay)} | ${Math.round(v.ageDays)} | ${fmtViews(p.blogViews)} | ${fmtViews(p.shortsViews)} | ${v.season.label || '-'}(×${v.season.mult}) | ${v.sales.label || '-'}(×${v.sales.mult}) | ${p.topic ?? '-'}:${p.species ?? 'general'} | ${cut(p.title, 34)} | ${judge} |`;
  };
  const head = '| 순위 | v2점수 | 하루조회 | 경과일 | 블로그누적 | 숏폼 | 제철 | 판매 | 주제키 | 제목 | 판정 |\n|---|---|---|---|---|---|---|---|---|---|---|';
  console.log(`기준 시각 ${d.now.toISOString()} · 브랜드 ${d.brand} · 판매 수종 ${d.sales?.size ?? 0}종 · LONGFORM_TOPIC_MODE 현재 ${d.mode}`);
  for (const mode of ['views', 'v2'] as TopicMode[]) {
    const dm: TopicDeps = { ...d, mode };
    const all = evaluateTopics(dm);
    console.log(`\n## ${mode === 'views' ? 'views — 블로그+숏폼 조회 합산(종전)' : 'v2 — 블로그 하루 조회 × 제철 × 판매(숏폼은 동점 순서만)'}`);
    console.log(`\n### 전체 상위 ${top}\n${head}`);
    all.slice(0, top).forEach((c) => console.log(row(c, c.rank)));
    console.log(`\n### 기둥 가능(쓴 글·같은 키·최근 작업·제철 통과) 상위 ${top}\n${head}`);
    all.filter((c) => c.eligible).slice(0, top).forEach((c) => console.log(row(c, c.rank)));
    const pick = selectTopic(dm);
    console.log(`\n선정(결정적, LLM 묶음 단계 생략): ${pick ? `${pick.topicKey} · ${pick.targetMinutes ? `목표 ${pick.targetMinutes}분` : '10분'} — ${pick.reason}` : '없음'}`);
    for (const q of pick?.pieces ?? []) console.log(`  · ${topicLabel(q.topic)} ${q.species ?? '-'} '${q.title}'`);
  }
  process.exit(0);
}
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
