/**
 * 네이버 블로그 포매터 — org 본문을 발행용 초안(제목·메타·태그·이미지 슬롯·SEO 점수)으로 포장.
 * 본문은 생성하지 않는다(작가가 이미 씀). 구조작업(제목/메타/태그/이미지 프롬프트)만 microJSON 1콜.
 */
import { microJSON } from '../orchestrator/agent';
import { firstJson } from '../tools/classify';
import { asString } from '../util/str';
import { seedKeyword } from '../grounding/naver_common';
import { scoreSeo } from './seo';
import { renderMarkdown, renderHtml, stripEmoji } from './render';
import { registerFormatter } from './formatter';
import { brandContext, getBrand, lexiconGuide, editorRulesGuide } from '../content/brand';
import { metaSummaryIssues, calqueIssues } from '../content/styleLint';
import { reportSpeakIssues, unsupportedClaimTokens, cleanImageMarkerDesc } from '../content/blogVoiceLint';
import { hasKeyword, naturalKeyword } from '../content/keywordForm';
import { CONFIG } from '../config';
import { seasonalContext } from '../util/solarTerms';
import type { AssetBundle, BlogDraft, FormatterInput } from './formatter';
import { TITLE_FORM_TEXT, type TitleForm } from '../content/structureSeed';

/**
 * 포장 시스템 프롬프트. formed(이번 런에 제목 형식이 주어짐, 2026-10-02)가 false 면 **종전 문구 그대로**다 —
 * STRUCTURE_VARIETY=off·구 시드 리비전에서 포장이 바이트 단위로 예전과 같아야 킬스위치 동일성 계약이 성립한다.
 * true 면 제목 꼴을 고정하던 두 군데를 뺀다: ① "키워드를 앞쪽에 … 클릭 유도"(40편 실측: 키워드 맨 앞 40/40·
 * "키워드, 반전 문장" 35/40) ② 절기 병기 예시 "…, 처서 전에 끝내야 하는 이유"(그 자체가 관점형 템플릿).
 * 형식은 사용자 프롬프트의 [이번 글 제목 형식] 블록이 정한다.
 */
const buildPackSystem = (formed: boolean): string =>
  '너는 네이버 블로그 SEO 편집자다. 주어진 블로그 본문을 바탕으로 발행용 메타데이터를 만든다.\n' +
  '- primaryKeyword: 이 글의 핵심 타겟 키워드 1개(검색량 있을 법한 명사구).\n' +
  (formed
    ? '- titles: 검색 노출에 유리한 제목 후보 5개. 핵심 키워드를 자연스럽게 포함, 15~40자. 첫 번째 후보(발행 제목)는 아래 [이번 글 제목 형식]을 따른다. 과장·낚시 금지. 사전에 없는 조어를 만들지 마라(실측 유출: "첫 식재자들" — "처음 심는 분들"처럼 일상어로).\n'
    : '- titles: 검색 노출에 유리한 제목 후보 5개. 핵심 키워드를 앞쪽에 자연스럽게, 15~40자, 클릭 유도. 과장·낚시 금지. 사전에 없는 조어를 만들지 마라(실측 유출: "첫 식재자들" — "처음 심는 분들"처럼 일상어로).\n') +
  '  [네이버 상위 노출 제목]이 주어지면 실제 상위 글들의 제목 패턴(구체 수치·대상·상황 명시)을 참고하되 그대로 베끼지 마라.\n' +
  // 절기 병기(2026-08-07 사용자 승인) — 실측상 절기 합성 키워드는 월 10미만이라 SEO 타겟은 불가하지만,
  // 제목 병기는 검색결과에서 "지금 안 하면 늦는다" 시의성 훅(CTR)이 된다. 키워드 대체 금지·선택 적용.
  '  [오늘·절기]가 주어지고 주제가 현재·다가오는 절기와 시기적으로 맞물리면, 제목 후보 1~2개에 절기명을 자연스럽게 병기하라'
  + (formed ? '(첫 후보에 넣을 때는 그 형식을 깨지 않는 자리에)' : '(예: "…, 처서 전에 끝내야 하는 이유")')
  + '. 핵심 키워드 표기를 절기로 대체하지 말고, 시기가 안 맞으면 넣지 마라.\n' +
  '- meta: 100~200자 요약(검색 스니펫용). 핵심 키워드 포함, 글의 이득을 한 문장으로.\n' +
  '  메타 요약투 금지 — "정리했습니다/담았어요/알아봅니다/알아보세요/살펴봅니다/소개합니다" 로 끝내지 말고 "결론 한 줄 + 조건 한 줄" 꼴로 써라(예: "잎이 상한 나무는 9월에 비료를 줘도 소용없습니다. 갈변이 어디서 시작됐는지부터 보세요.").\n' +
  '- tags: 5~10개(핵심·연관 키워드, # 없이). 띄어쓰기 없이 붙여쓴다("카페창업" O, "카페 창업" X). 본문과 무관한 태그 금지.\n' +
  '- images: 본문 흐름에 맞는 이미지 3개 슬롯. alt(대체텍스트)와 prompt(이미지 생성 프롬프트, 한국어).\n' +
  '이모지·이모티콘·장식 특수문자는 제목·메타·태그 어디에도 쓰지 마라. 본문에 없는 사실을 지어내지 마라.';
const PACK_SYSTEM = buildPackSystem(false);
const PACK_SYSTEM_FORMED = buildPackSystem(true);

/** [이번 글 제목 형식] 블록(순수) — 첫 후보에 형식을 걸고, 핵심 키워드 포함을 못박는다.
 *  2026-10-05 — 종전 "띄어쓰기·붙여쓰기까지 그대로"가 검색어 꼴("대추나무 심는시기")을 제목·본문 주어로 세웠다.
 *  seo.ts 판정이 띄어쓰기·조사를 무시하므로(keywordForm.hasKeyword) 바른 띄어쓰기 꼴을 요구한다. */
export function titleFormBlock(form: TitleForm, keyword?: string): string {
  return `\n[이번 글 제목 형식 — titles 첫 번째 후보(발행 제목)에 반드시 적용] ${TITLE_FORM_TEXT[form]}.\n`
    + `- 어느 형식이든 ${keyword ? `핵심 키워드 "${keyword}"를 바른 띄어쓰기의 자연스러운 꼴("${naturalKeyword(keyword)}")로` : '핵심 키워드를 바른 띄어쓰기의 자연스러운 꼴로'} 포함하고(조사를 붙여도 된다), 15~40자를 지키고, 본문이 다루지 않는 내용을 약속하지 마라. 키워드·연관어를 나열하지 마라(나열형 제목은 저품질 신호).\n`
    + '- 이 형식은 위 [리서치·SEO 브리프]의 제목 후보·[네이버 상위 노출 제목]의 패턴보다 우선한다(그 자료는 키워드·소재 참고로만).\n'
    // 2026-10-05 — compare 형식이 브리프 확정 제목을 덮고 본문 한 줄("성공률이 높고요")을 "가을 vs 봄 성공률이 다른 이유"로 부풀렸다.
    // 형식은 제목의 꼴만 정한다 — 무엇을 주장하는지는 본문 결론이 정한다.
    + '- 형식은 꼴만 정한다 — 제목의 주장은 [이 글의 결론]과 본문에 있는 것만 쓴다. 본문에 없는 비교("vs", "성공률")·최상급("마지막", "가장")·"N가지"를 제목에 넣지 마라.\n'
    + '- 나머지 4개 후보는 서로 다른 형식으로 써도 된다(사람이 고를 대안).\n';
}

/** 작가가 본문 끝에 남기는 태그류 제거(순수) — ① "태그: #…" 줄(종전) ② 맨 키워드 나열
 *  (구두점 없는 4+ 토큰 한 줄, 실측 2026-08-10: "포도나무수확시기 … 비온디트리"가 본문으로 발행됨).
 *  태그는 발행 시 별도 필드로 입력되므로 본문 노출은 순수 중복+키워드 덤프(스팸 신호)다.
 *  정상 마무리 문단은 구두점(마침표·쉼표 등)을 포함하므로 걸리지 않는다. */
export function stripTrailingTagDump(body: string): string {
  return body
    .replace(/\n+\s*(?:\*\*)?태그(?:\*\*)?\s*[:：][^\n]*$/u, '')
    .replace(/\n+\s*(?:[가-힣A-Za-z0-9]{2,20}[ \t]+){3,}[가-힣A-Za-z0-9]{2,20}[ \t]*$/u, '')
    .trimEnd();
}

/** 발행 초안에서 내부 표식 제거(순수, 스펙 §6c) — 감사 실측: "[근거: 확립된 원예학 지식]"·"⚠️ 데이터 없음:" 이 그대로 발행됐다.
 *  인라인 표식은 문장부호(.!?) 또는 괄호에서 소비를 멈춘다 — 안 그러면 뒤따르는 문장까지 삼켜 내용이 유실된다(리뷰 라운드 1). */
export function stripInternalMarkers(md: string): string {
  return md
    // stripEmoji 가 먼저 돌아 ⚠️ 가 이미 지워졌을 수 있다 — 이모지는 통째로 선택(optional group).
    // 공백은 그룹 '안'에 둔다: 종전 `(?:⚠️?)?\s*` 는 앞뒤 \s* 사이에 선택 그룹이 끼어 "긴 공백 +
    // 비매칭"에서 지수 백트래킹을 일으켰다(실측: 공백 3000자 → 6.0초). stripEmoji 가 ⚠ 자체를
    // Extended_Pictographic 로 지우므로 VS16 없는 맨 ⚠ 는 여기 도달하지 않는다(실측 확인).
    .replace(/^[ \t]*(?:[-*]\s*)?(?:⚠️\s*)?데이터 없음\s*[:：][^\n]*\n?/gmu, '')
    .replace(/\s*(?:⚠️\s*)?데이터 없음\s*[:：][^\n().!?]*(?:\([^)]*\))?/gu, '')
    .replace(/\s*\[\s*근거\s*[:：]\s*([^\]]*)\]/gu, (_m, inner: string) => {
      const url = /https?:\/\/[^\s\]]+/.exec(inner)?.[0];
      return url ? ` (출처: ${url})` : '';
    })
    .replace(/[ \t]+([.,!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 블로그 이미지 장수(2026-10-05) — 실촬영 1 + 생성 2, 또는 생성 3. 작가 지시("정확히 N곳")·포장 슬롯·디자이너 계획·finalize 생성 한도·
 * 실촬영 슬롯 합치기가 모두 이 값을 본다(따로 적힌 3이 어긋나면 빈 자리·고아 이미지가 생긴다).
 */
export const BLOG_IMAGE_MAX = 3;
/** 렌더(render.ts·smarteditor.ts)와 같은 판정 — 한 줄 전체가 마커인 줄만 이미지 자리다. */
const IMAGE_MARKER_LINE_RE = /^\s*\[IMAGE:([^\]]*)\]\s*$/;

/** 본문의 이미지 자리(단독 마커 줄) 수(순수). */
export function countImageMarkers(md: string): number {
  return String(md ?? '').split('\n').filter((l) => IMAGE_MARKER_LINE_RE.test(l)).length;
}

/**
 * 이미지 마커 하한 채우기(순수, 2026-10-12 사장님 지적 "이미지가 2개밖에 없는데") — 작가가 "정확히 3곳" 지시를 어기고 마커 2개만
 * 달면 이미지 수가 마커 수로 줄었다(imageTotal = markerCount || 3). 모자란 만큼, 마커가 없는 소제목 절의 끝(다음 소제목 앞)에
 * "[IMAGE: 소제목 장면]" 마커를 더한다. 앞쪽 절부터, 마지막 절(마무리)은 다른 자리가 없을 때만. 이미 n개 이상이면 그대로.
 */
export function ensureImageMarkers(md: string, n: number = BLOG_IMAGE_MAX): { body: string; added: number } {
  const lines = String(md ?? '').split('\n');
  let have = lines.filter((l) => IMAGE_MARKER_LINE_RE.test(l)).length;
  if (have >= n) return { body: md, added: 0 };
  const heads = lines.map((l, i) => (/^##\s+\S/.test(l) ? i : -1)).filter((i) => i >= 0);
  const sections = heads.map((h, k) => ({ head: h, end: k + 1 < heads.length ? heads[k + 1]! : lines.length }));
  const free = sections.filter((sec) => !lines.slice(sec.head, sec.end).some((l) => IMAGE_MARKER_LINE_RE.test(l)));
  const order = free.length > 1 ? [...free.slice(0, -1), free[free.length - 1]!] : free; // 마무리 절은 맨 뒤 후보
  const picks = order.slice(0, n - have).sort((a, b) => b.head - a.head); // 뒤에서부터 넣어야 앞 인덱스가 안 밀린다
  for (const sec of picks) {
    const title = lines[sec.head]!.replace(/^##\s+/, '').replace(/\*\*/g, '').trim().slice(0, 40);
    let at = sec.end;
    while (at > sec.head + 1 && !lines[at - 1]!.trim()) at--; // 절 끝의 빈 줄 앞
    while (at > sec.head + 1 && /^---\s*$/.test(lines[at - 1]!.trim())) { at--; while (at > sec.head + 1 && !lines[at - 1]!.trim()) at--; } // 구분선 앞
    lines.splice(at, 0, '', `[IMAGE: ${title} 장면]`, '');
    have++;
  }
  return { body: lines.join('\n').replace(/\n{3,}/g, '\n\n'), added: picks.length };
}

/**
 * 이미지 마커 상한·설명 정리(순수, 2026-10-05 대추나무 리비전 dbb3ea1b6aa6) — 작가가 마커 6개를 달았는데 이미지는 3장(실촬영 1 + 생성 2)이라
 * 빈 자리 3곳이 미리보기·발행에 남았다. 이미지가 만들어질 장수(max)만큼만 남긴다: 첫 마커(실촬영 자리)는 항상 남기고 나머지는 글 전체에
 * 고르게(k·(M−1)/(N−1) 반올림 — 첫·끝 포함). 남긴 마커의 설명에서는 실사진 전용 요구(지명·날짜·촬영·캡션)를 덜어 낸다
 * (blogVoiceLint.cleanImageMarkerDesc — 디자이너가 "경산 밭 배경"을 그대로 옮겼다). places = 브랜드 지역 낱말.
 */
export function capImageMarkers(md: string, max = BLOG_IMAGE_MAX, places: readonly string[] = []): { body: string; kept: number; removed: number; cleaned: number } {
  const lines = String(md ?? '').split('\n');
  const at = lines.map((l, i) => (IMAGE_MARKER_LINE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  const n = Math.max(0, Math.min(max, at.length));
  const keep = new Set<number>();
  for (let k = 0; k < n; k++) keep.add(at[n === 1 ? 0 : Math.round((k * (at.length - 1)) / (n - 1))]!);
  let cleaned = 0;
  const out: string[] = [];
  lines.forEach((l, i) => {
    const m = IMAGE_MARKER_LINE_RE.exec(l);
    if (!m) { out.push(l); return; }
    if (!keep.has(i)) return;
    const desc = (m[1] ?? '').trim();
    const clean = cleanImageMarkerDesc(desc, places);
    if (clean !== desc) cleaned++;
    out.push(clean !== desc ? `[IMAGE: ${clean}]` : l);
  });
  const removed = at.length - keep.size;
  const body = removed ? out.join('\n').replace(/\n{3,}/g, '\n\n') : out.join('\n');
  return { body, kept: keep.size, removed, cleaned };
}

/** 브랜드 지역 낱말("경북 경산" → ['경북', '경산']) — 마커 설명 지명 정리용. */
export function brandPlaceWords(): string[] {
  return String(getBrand()?.region ?? '').split(/[\s,·]+/).filter((w) => w.length >= 2);
}

/**
 * 포장기용 브리프 발췌(순수, 2026-10-05) — 종전엔 브리프 앞 1,500자를 그대로 넣었는데, 대추나무 런의 앞 1,500자는 처리 투명성
 * 로그였다. 각도·확정 제목·금칙("마지막" 금지)이 보이지 않았고, 메타에 런 주제의 "마지막"이 새어 "마지막 가을 창"이 됐다.
 * 각도·검색 의도·제목 절과 '금칙' 줄만 뽑는다. 섹션 구성안·키워드 밀도 설계·템플릿은 뺀다(제목·메타가 따라 할 문장이 아니다).
 * 찾지 못하면 빈 문자열 — 앞 N자 폴백은 이번 사고의 원인 그 자체라 두지 않는다.
 */
const ANGLE_SKIP_RE = /구성안|템플릿|밀도|배치|섹션|체크리스트|투명성/;
// 라벨 두 꼴 — ① "4. 차별화 각도: …"·"- 금칙: …"(콜론) ② 번호 붙은 콜론 없는 머리 줄 "5. 제목 방향·태그 후보"(줄 끝까지 라벨, 리뷰 2026-10-05).
//   ②를 번호 줄로만 한정하는 이유: "- 제목에 키워드 넣기" 같은 본문 목록 줄이 라벨로 잡히지 않게.
const ANGLE_LABELS = '(?:차별화\\s*각도|검색\\s*의도|금칙|제목[^:：\\n]{0,12}|각도)';
const ANGLE_LABEL_RE = new RegExp(`^\\s*(?:(?:\\d+[.)]\\s*|[-*]\\s*)?\\**${ANGLE_LABELS}\\**\\s*[:：]|\\d+[.)]\\s*\\**${ANGLE_LABELS}\\**\\s*$)`);
/** 우선순위 — 금칙 > 제목 > 각도 > 검색 의도. 상한(cap)에 잘려도 금칙·확정 제목이 먼저 남는다. */
const ANGLE_PRIORITY: ReadonlyArray<RegExp> = [/금칙/, /제목/, /각도/, /검색\s*의도/];
export function briefAngleForPackaging(brief: string | undefined, cap = 1800): string {
  const src = String(brief ?? '');
  if (!src.trim()) return '';
  const cut = src.search(/^#{1,4}\s*재배·이야기 사실 조사/m);
  const lines = (cut >= 0 ? src.slice(0, cut) : src).split('\n');
  const level = (l: string): number => (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 0);
  const groups: number[][] = ANGLE_PRIORITY.map(() => []);
  const seen = new Set<number>();
  const take = (g: number, i: number): void => { if (!seen.has(i)) { seen.add(i); groups[g]!.push(i); } };
  const groupOf = (l: string): number => ANGLE_PRIORITY.findIndex((re) => re.test(l));
  // ① 금칙 줄 — 어디에 있든.
  lines.forEach((l, i) => { if (/금칙/.test(l) && !/^\s*\|/.test(l)) take(0, i); });
  // ② 머리글 절(## §6. 차별화 각도 …·## 6. 금칙) — 같은 깊이 이하의 다음 머리글까지. 표(근거 목록)는 뺀다.
  //    리뷰(2026-10-05): 종전엔 g < 1 이라 금칙 머리글은 ①에서 머리 줄만 잡히고 본문(금지 목록)이 빠졌다.
  lines.forEach((l, i) => {
    const lv = level(l);
    const g = groupOf(l);
    if (!lv || g < 0 || ANGLE_SKIP_RE.test(l)) return;
    take(g, i);
    for (let j = i + 1; j < lines.length; j++) {
      const lj = level(lines[j]!);
      if (lj && lj <= lv) break;
      if (!/^\s*\|/.test(lines[j]!)) take(g, j);
    }
  });
  // ③ 표준 브리프 꼴("4. 차별화 각도: …", "6. 금칙:", "5. 제목 방향·태그 후보") — 라벨 줄과 이어지는 줄.
  //    이어지는 줄: 목록(- …)은 빈 줄·번호 줄·머리글 전까지 전부(금칙 목록이 2줄을 넘는다), 맨 문장은 2줄까지.
  //    리뷰(2026-10-05): 종전 Math.max(1, …)는 금칙 라벨 본문을 제목 묶음으로 보내 머리 줄(금칙 묶음)과 갈라 놓았다.
  lines.forEach((l, i) => {
    if (!ANGLE_LABEL_RE.test(l)) return;
    const g = groupOf(l);
    if (g < 0) return;
    take(g, i);
    let plain = 0;
    for (let j = i + 1; j < lines.length && lines[j]!.trim() && !/^\s*(?:\d+[.)]|#)/.test(lines[j]!); j++) {
      if (!/^\s*[-*·]\s/.test(lines[j]!) && ++plain > 2) break;
      take(g, j);
    }
  });
  const text = groups.flatMap((g) => g.sort((a, b) => a - b).map((i) => lines[i]!))
    .map((l) => l.replace(/\s*\[근거\s*[:：][^\]]*\]/g, '').replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^\s*-{3,}\s*$/.test(l))
    .join('\n');
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * 포장기용 본문 결론(순수, 2026-10-05) — 제목·메타·굵은 요약·맺음이 한 가지 말을 하게 한다. 첫머리 굵은 요약 줄 + 도입 덩어리 +
 * 마지막 소제목 절(결론)을 따로 보여 주고 "제목·meta 는 이 말과 같아야 한다"고 못박는다. 본문 6,000자 전체도 함께 가지만,
 * 앞부분에 끌려 결론과 다른 말을 메타에 쓰던 사고(메타 "마지막 가을 창" vs 본문 "봄이 더 낫다")를 막으려는 것이다.
 */
export function bodySummaryForPackaging(body: string, cap = 1200): string {
  const lines = String(body ?? '').split('\n');
  const clean = (l: string): string => l.replace(/\[IMAGE:[^\]]*\]/g, '').replace(/^\s*>+\s*/, '').trim();
  const firstH2 = lines.findIndex((l) => /^##\s/.test(l));
  const lead = (firstH2 >= 0 ? lines.slice(0, firstH2) : lines.slice(0, 8)).map(clean).filter((l) => l && !/^-{3,}$/.test(l));
  let lastH2 = -1;
  lines.forEach((l, i) => { if (/^##\s/.test(l)) lastH2 = i; });
  const close = lastH2 > firstH2 && lastH2 >= 0
    ? lines.slice(lastH2).map(clean).filter((l) => l && !/^-{3,}$/.test(l) && !/^\|/.test(l))
    : [];
  const leadText = lead.join('\n').slice(0, 450);
  const closeText = close.join('\n');
  const out = [leadText ? `(첫머리)\n${leadText}` : '', closeText ? `(결론 절)\n${closeText.length > 600 ? `…${closeText.slice(-600)}` : closeText}` : '']
    .filter(Boolean).join('\n');
  return out.slice(0, cap);
}

export async function packageNaverBlog(input: FormatterInput): Promise<AssetBundle> {
  const { topic, researchBrief, serpText, model, titleForm, signal } = input;
  const pinnedKeyword = stripEmoji(asString(input.keyword).trim());
  // 이모지 결정적 제거 — 지침(작가·편집자 프롬프트)이 1차 방어, 여기가 최종 보증(발행 초안엔 이모지 0).
  // 이미지 마커 상한·설명 정리(2026-10-05) — 호출부(org.packageDesignFinalize)가 이미 맞췄어도 다른 호출 경로를 위해 한 번 더(멱등).
  const body = capImageMarkers(stripInternalMarkers(stripTrailingTagDump(stripEmoji(input.body))), BLOG_IMAGE_MAX, brandPlaceWords()).body;
  const markerCount = countImageMarkers(body);
  const bodySummary = bodySummaryForPackaging(body);
  const briefAngle = briefAngleForPackaging(researchBrief);
  type PackMeta = {
    primaryKeyword?: string; titles?: unknown; meta?: string; tags?: unknown;
    images?: Array<{ alt?: string; prompt?: string }>;
  };
  // 지연 조립 — meta 요약투 재시도(권고 2)는 같은 프롬프트에 피드백만 덧붙여 다시 부른다. 함수로 두는 이유는
  // 조립부(seasonalContext·brandContext·getBrand·lexiconGuide)가 던져도 호출부 try 안에서 터지게 하기 위해서다:
  // 문 수준에서 조립하면 종전에 fail-open(meta=null 폴백)이던 실패가 포장 전체를 죽인다.
  const packUser = () =>
      // 2026-10-05 — 런 시작 주제("…, 11월 지금이 마지막 식재 시즌입니다")의 "마지막"이 메타로 새어 들어갔다. 주제는 참고로 낮추고,
      // 제목·메타가 따라야 할 기준은 본문 결론([이 글의 결론])으로 둔다.
      `[런 시작 주제 — 참고만. 본문·결론과 다르면 본문을 따른다] ${topic}\n\n[오늘·절기] ${seasonalContext()}\n\n[본문]\n${body.slice(0, 6000)}\n` +
      (bodySummary ? `\n[이 글의 결론 — titles·meta 는 이 말과 같은 주장이어야 한다. 여기·본문에 없는 비교·최상급("마지막", "가장", "성공률", "vs")·날짜를 새로 만들지 마라]\n${bodySummary}\n` : '') +
      // SEO 포장도 microJSON 직행 — 브랜드 설정 시 태그·메타에 브랜드 연관 키워드가 자연스럽게 실리게.
      (brandContext() ? `\n${brandContext()}\n` : '') +
      `\n${lexiconGuide(getBrand()?.avoidJargon, getBrand()?.keepTerms)}\n` + // 어휘 가드(2026-08-08) — 제목·메타·태그의 함정어·조어 방지
      (editorRulesGuide() ? `\n${editorRulesGuide()}\n` : '') + // 편집 확정 규칙(2026-10-05) — 제목·메타도 같은 쉬운 말 규칙(참고 블로그 2026-10-03 같은 자리)
      // 2026-10-05 — primaryKeyword 는 고정값 그대로(과녁), 제목·meta 는 바른 띄어쓰기 꼴로(검색어 꼴을 주어로 세우지 않게).
      (pinnedKeyword ? `\n[핵심 키워드(고정)] ${pinnedKeyword} — primaryKeyword 는 정확히 이 값으로 쓰고, titles 5개 중 4개 이상과 meta 에는 이 키워드를 바른 띄어쓰기의 자연스러운 꼴("${naturalKeyword(pinnedKeyword)}")로 포함하라(조사를 붙여도 된다 — 검색은 띄어쓰기·조사를 가려 읽는다). 검색어 꼴을 문장 주어로 세우거나 "~의"로 잇는 명사구로 쓰지 마라.\n` : '') +
      (serpText ? `\n[네이버 상위 노출 제목(실측)]\n${serpText.slice(0, 800)}\n` : '') +
      // 2026-10-05 — 앞 1,500자 대신 각도·검색 의도·제목·금칙 발췌(briefAngleForPackaging). 못 찾으면 넣지 않는다.
      `${briefAngle ? `\n[리서치·SEO 브리프]\n(각도·제목 방향·금칙 발췌 — 금칙은 지켜라)\n${briefAngle}` : ''}\n\n` +
      // 제목 형식 블록은 브리프·SERP 뒤, 형식 줄 바로 앞 — 브리프(SEO 전략가의 '제목 후보', 페르소나 규칙 "키워드 앞부분·
      // 클릭 유도")와 상위 노출 제목이 대부분 키워드 맨 앞 관점형이라, 블록이 그보다 앞에 있으면 마지막에 읽힌 꼴로 끌려간다.
      (titleForm ? `${titleFormBlock(titleForm, pinnedKeyword || undefined)}\n` : '') +
      `형식: {"primaryKeyword":"...","titles":["...","...","...","...","..."],"meta":"...","tags":["...","..."],"images":[{"alt":"...","prompt":"..."}]}`;
  const askPack = (feedback: string) => microJSON<PackMeta>(model, titleForm ? PACK_SYSTEM_FORMED : PACK_SYSTEM, packUser() + feedback, { maxOutputTokens: 900, signal });
  let meta: PackMeta | null = null;
  try { meta = await askPack(''); } catch { /* 포장 실패 시 폴백 아래 */ }

  // 요약투 린트 + 같은 콜 1회 재시도(2026-08-27 권고 2). 검사는 '실제로 실릴' 문자열(이모지 제거·200자 절단
  // 뒤)에 건다 — 원본 필드를 보면 린트와 발행물이 갈라지고 잔존 로그가 다른 문장을 인용하게 된다.
  // 재시도가 깨끗할 때 갈아끼우는 것은 meta 뿐이다: 제목 후보·태그는 자기 제약(15~40자·키워드 4/5 포함·
  // 조어 금지)이 따로 있어 meta 표적 재생성이 통째로 덮으면 통제 못 하는 드리프트가 된다.
  // META_SUMMARY_LINT 게이트(Fix wave 2026-08-27 소견 4) — 이 검사가 만드는 2번째 askPack 콜만
  // 되돌릴 레버가 없었다(계획서 Global Constraints: 모든 새 동작에 킬스위치). off 면 검사 자체를 건너뛴다.
  const metaText = (m: PackMeta | null): string => stripEmoji(asString(m?.meta)).trim().slice(0, 200);
  let metaDescription = metaText(meta);
  // 영어 직역 말투(2026-10-05) — 실측 메타 "…대추나무 심는시기의 마지막 가을 창입니다"가 검색 스니펫으로 나갔다. 같은 재시도에 얹는다.
  // 일관성·보고서 말투(2026-10-05) — 실측 메타 "마지막 가을 창 … 생존율이 높은 봄으로"는 본문에 없는 주장(마지막·생존율)이었다.
  // 메타에만 있는 최상급·비교·확률·날짜 표현을 같은 재시도에 얹는다(META_SUMMARY_LINT 킬스위치 공유).
  const metaLint = (t: string): string[] => {
    const bad = unsupportedClaimTokens(t, body);
    return [...metaSummaryIssues(t), ...calqueIssues(t), ...reportSpeakIssues(t),
      ...(bad.length ? [`본문에 없는 주장 "${bad.join('", "')}" — meta 는 [이 글의 결론]과 같은 말만 하라`] : [])];
  };
  const metaIssues = CONFIG.metaSummaryLint ? metaLint(metaDescription) : [];
  if (metaIssues.length) {
    try {
      const retry = await askPack(
        `\n\n[meta 재작성 — 아래 지적만 고쳐 같은 JSON 스키마로 다시 출력하라(다른 필드는 그대로 둬도 된다)]\n`
        + metaIssues.map((i) => `- ${i}`).join('\n'),
      );
      const fixed = metaText(retry);
      // 리뷰(2026-10-05) — 지적이 '줄기만' 해도 채택한다. 종전엔 0건일 때만 받아, 2건 중 1건을 고친 재시도도 버리고 1차(더 나쁜 쪽)를 남겼다.
      if (fixed && metaLint(fixed).length < metaIssues.length) metaDescription = fixed;
    } catch { /* 재시도 실패 = 1차 meta 유지(fail-open — 포장은 계속 간다) */ }
    // 잔존은 로그만 — 발행을 막지 않는다(린트 공통 원칙).
    if (metaLint(metaDescription).length) console.log(`[메타] 요약투 잔존 — "${metaDescription.slice(0, 60)}"`);
  }

  // 고정 키워드 우선 — LLM 재추출값은 고정이 없을 때만(과녁 고정: 검사기·리비전 피드백·제목이 같은 표기를 본다).
  const primaryKeyword = pinnedKeyword || stripEmoji(asString(meta?.primaryKeyword).trim() || seedKeyword(topic));
  const titles = (Array.isArray(meta?.titles) ? meta!.titles as unknown[] : [])
    .map((t) => stripEmoji(asString(t)).trim()).filter(Boolean).slice(0, 5);
  // 제목 형식 런의 키워드 보증(2026-10-02) — 형식을 지키다 1순위가 고정 키워드를 잃으면(seo '제목에 핵심 키워드 포함' 실패)
  // 키워드를 담은 다음 후보를 1순위로 올린다. 형식보다 과녁 고정이 우선이다. 형식 없는 런은 종전 그대로(순서 불변).
  if (titleForm && pinnedKeyword && titles.length > 1 && !hasKeyword(titles[0]!, pinnedKeyword)) {
    const i = titles.findIndex((t) => hasKeyword(t, pinnedKeyword));
    if (i > 0) {
      console.log(`[제목] 형식(${titleForm}) 1순위에 키워드 "${pinnedKeyword}" 없음 — ${i + 1}순위 "${titles[i]}"로 교체`);
      titles.unshift(...titles.splice(i, 1));
    }
  }
  // 제목 근거 보증(2026-10-05) — 1순위 제목에 본문에 없는 주장어(성공률·vs·마지막·가장·N가지·날짜)가 있으면, 주장어가 없고
  // (고정 키워드가 있으면) 키워드를 담은 다음 후보로 바꾼다. 실측: "대추나무 심는시기, 가을 vs 봄 성공률이 다른 이유" — 본문엔
  // 성공률 비교가 없었다. 대안이 없으면 그대로 두고 로그만(fail-open). META_SUMMARY_LINT 킬스위치를 같이 쓴다.
  if (CONFIG.metaSummaryLint && titles.length > 1 && unsupportedClaimTokens(titles[0]!, body).length) {
    const i = titles.findIndex((t, k) => k > 0 && !unsupportedClaimTokens(t, body).length && (!pinnedKeyword || hasKeyword(t, pinnedKeyword)));
    const bad = unsupportedClaimTokens(titles[0]!, body).join('·');
    if (i > 0) {
      console.log(`[제목] 1순위 "${titles[0]}"에 본문에 없는 주장(${bad}) — ${i + 1}순위 "${titles[i]}"로 교체`);
      titles.unshift(...titles.splice(i, 1));
    } else console.log(`[제목] 1순위 "${titles[0]}"에 본문에 없는 주장(${bad}) — 대안 없음, 유지`);
  }
  const titleCandidates = titles.length ? titles : [topic];
  const tags = (Array.isArray(meta?.tags) ? meta!.tags as unknown[] : [])
    .map((t) => stripEmoji(asString(t)).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  const imageSlots = (meta?.images ?? [])
    .map((im) => ({ alt: stripEmoji(asString(im?.alt)).trim(), prompt: asString(im?.prompt).trim() }))
    // 이미지 실생성 한도(BLOG_IMAGE_MAX)와 일치 — 미생성 파일 참조 방지. 마커가 있으면 마커 수까지만(남는 슬롯은 본문 끝 고아 이미지가 된다).
    .filter((im) => im.alt || im.prompt).slice(0, markerCount || BLOG_IMAGE_MAX);
  const internalLinks = input.internalLinks ?? [];

  const seo = scoreSeo({ title: titleCandidates[0] ?? topic, body, primaryKeyword, tags, imageSlots: imageSlots.length });
  const draft: BlogDraft = { topic, primaryKeyword, titleCandidates, metaDescription, tags, imageSlots, internalLinks, bodyMarkdown: body, seo };

  return {
    platform: 'naver_blog',
    files: draftFiles(draft),
    meta: { title: titleCandidates[0], titleCandidates, seoScore: seo.score, tags, primaryKeyword },
    draft,
  };
}

/**
 * 초안 → 세션 파일 목록(draft.json/md/html + image-prompts.md). 슬롯이 갱신되면(디자이너 협의) 재호출해 동기화.
 * imagesReady=true 면 draft.html 이 세션 images/blog-image-0N.png 를 <img> 로 참조(이미지 실생성 런).
 * readySlots 를 주면 그 슬롯만 <img>, 나머지는 자리표시 — 생성 후 실제 파일로 재렌더할 때 쓴다.
 */
export function draftFiles(
  draft: BlogDraft, imagesReady = false, readySlots?: ReadonlySet<number>,
): Array<{ name: string; content: string }> {
  const files = [
    { name: 'draft.json', content: JSON.stringify(draft, null, 2) },
    { name: 'draft.md', content: renderMarkdown(draft) },
    { name: 'draft.html', content: renderHtml(draft, { imagesReady, readySlots }) },
  ];
  if (draft.imageSlots.length) {
    files.push({ name: 'image-prompts.md', content: draft.imageSlots.map((s, i) => `${i + 1}. **${s.alt}**\n   ${s.prompt}`).join('\n\n') });
  }
  return files;
}

/**
 * 이미지 디자이너의 계획 텍스트 → 이미지 슬롯(alt/prompt). 자유 서술 뒤 JSON 한 줄
 * ({"images":[{"alt","prompt"}]}) 을 firstJson 으로 추출, alt·prompt 둘 다 있는 항목만 최대 max.
 * 실패/빈 계획이면 [] — 호출부가 기존 슬롯을 유지(fail-open). 순수 함수 — 단위 테스트 대상.
 */
export function parseImagePlan(text: string, max = 3): Array<{ alt: string; prompt: string }> {
  const j = firstJson<{ images?: Array<{ alt?: unknown; prompt?: unknown }> }>(text ?? '');
  const arr = Array.isArray(j?.images) ? j!.images : [];
  return arr
    .map((im) => ({ alt: asString(im?.alt).trim(), prompt: asString(im?.prompt).trim() }))
    .filter((im) => im.alt && im.prompt)
    .slice(0, Math.max(1, max));
}

registerFormatter('naver_blog', packageNaverBlog);
