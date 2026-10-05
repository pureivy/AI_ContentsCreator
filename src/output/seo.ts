/**
 * 결정적(zero-LLM) 네이버 블로그 SEO 스코어러 + 체크리스트.
 * 네이버 C-Rank/DIA 는 비공개 + 과최적화 역효과 → 이 점수는 '가이드'(패널티 밴드)이지 극대화 타겟이 아니다.
 */
import { findTemplateNumbers } from '../orchestrator/agent';
import { hasKeyword, countKeyword } from '../content/keywordForm';

export interface SeoCheck { label: string; ok: boolean; note?: string }
export interface SeoResult { score: number; checklist: SeoCheck[] }

/** 한국어 대략 글자수(공백 제외 아님 — 전체 길이). */
function len(s: string): number { return (s || '').length; }

export function scoreSeo(input: {
  title: string;
  body: string;
  primaryKeyword: string;
  tags: string[];
  imageSlots: number;
}): SeoResult {
  const { title, body, primaryKeyword: kw, tags, imageSlots } = input;
  const checks: SeoCheck[] = [];
  const add = (label: string, ok: boolean, note?: string) => checks.push({ label, ok, note });

  // 제목
  const tl = len(title);
  add('제목 길이 적정(15~40자)', tl >= 15 && tl <= 40, `${tl}자`);
  // 키워드 판정은 띄어쓰기·조사를 무시한다(2026-10-05, keywordForm.ts) — 검색어 꼴 "대추나무 심는시기"와 글 꼴
  // "대추나무 심는 시기는"을 같게 본다. 종전 includes 판정이 검색어 꼴을 문장 주어로 세우게 만든 원인이었다.
  add('제목에 핵심 키워드 포함', !!kw && hasKeyword(title, kw));

  // 본문 구조
  const h2 = (body.match(/^##\s/gm) || []).length;
  const h3 = (body.match(/^###\s/gm) || []).length;
  add('소제목(H2) 3개 이상', h2 >= 3, `H2 ${h2} · H3 ${h3}`);
  const bl = len(body);
  add('본문 분량 적정(1,500~4,000자)', bl >= 1500 && bl <= 4000, `${bl}자`);

  // 키워드 배치·밀도
  // 도입부 = 첫 소제목 앞 글 문단 2개(2026-10-05, 참고 블로그 2026-10-02 수선 이식). 첫머리 굵은 요약 두 줄(편집 확정 규칙)이
  // 생기면서 '첫 문단'이 요약 한 줄이 될 수 있다 — 키워드가 둘째 요약 줄이나 바로 다음 도입 문단에 있어도 도입부로 인정한다.
  // 이미지 자리·구분선은 건너뛰고, 굵게·이탤릭 마커는 떼고 본다("**라일락** 꽃말"이 "라일락 꽃말"과 같게).
  // 소제목으로 바로 시작하는 글은 도입부가 없다 — 종전엔 소제목 아래 첫 문단을 봤지만, 그건 첫 문단이 아니다(참고 블로그와 같은 판정).
  // 리뷰(2026-10-05): 그러면 소제목으로 바로 시작하는 글은 늘 미달이 된다 — 그 경우엔 첫 소제목 자체나 그 바로 아래
  // 굵은 요약 덩어리(줄마다 **…**)에 키워드가 있어도 인정한다('키워드가 글 맨 앞에 나온다'는 뜻은 그대로).
  const paras = body.split(/\n\n/).map((x) => x.trim()).filter((p) => p && !/^\[IMAGE:/.test(p) && !/^-{3,}$/.test(p));
  const lead: string[] = [];
  for (const p of paras) {
    if (p.startsWith('#')) break;
    lead.push(p);
    if (lead.length === 2) break;
  }
  if (!lead.length && paras[0]?.startsWith('#')) {
    lead.push(paras[0].replace(/^#+\s*/, ''));
    const next = paras[1];
    if (next && !next.startsWith('#') && next.split('\n').every((l) => /^\*\*.+\*\*[.!?…]?$/.test(l.trim()))) lead.push(next);
  }
  add('첫 문단에 핵심 키워드', !!kw && hasKeyword(lead.join('\n'), kw));
  const occ = countKeyword(body, kw);
  const density = bl > 0 && kw ? (occ * kw.length) / bl * 100 : 0;
  add('키워드 밀도 0.5~2.5%(과최적화 경계)', density >= 0.5 && density <= 2.5, `${density.toFixed(1)}% (${occ}회)`);

  // 태그·이미지
  add('태그 5~10개', tags.length >= 5 && tags.length <= 10, `${tags.length}개`);
  add('이미지 슬롯 1개 이상', imageSlots >= 1, `${imageSlots}개`);

  // 플레이스홀더/가짜수치 없음
  const ph = findTemplateNumbers(body);
  add('플레이스홀더/가짜수치 없음', ph.length === 0, ph.length ? ph.slice(0, 4).join(', ') : undefined);

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  return { score, checklist: checks };
}
