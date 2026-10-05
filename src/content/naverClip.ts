/**
 * 네이버 클립 발행 — 순수 규칙(2026-10-02 사장님 확정: 유튜브용 숏폼을 사람 버튼으로 클립에도 올린다).
 *
 * 클립엔 공개 업로드 API 가 없다. 클립 크리에이터 PC웹(clipcreators.naver.com/web/upload)을 블로그 발행과
 * 같은 Playwright 프로필로 조작한다(scripts/blog_skills/naver_clip_publish.py). 이 파일은 그 스크립트에
 * 넘길 값만 만든다 — 브라우저·파일 시스템을 건드리지 않는다.
 *
 * 정찰로 확인한 화면 사실(2026-10-02):
 *  · 제목 칸이 없다. 설명(textarea[name=description], 필수, 300자)이 전부라 제목·해시태그도 여기 들어간다.
 *  · 카테고리 필수 — 사장님이 손으로 올린 편들은 '리빙, 홈 › 원예, 재배'(API: LIVING/GARDENING).
 *  · 콘텐츠 링크(블로그)가 따로 있어 원본 글은 거기 붙인다 — 설명에 URL 을 넣지 않는다.
 *  · 커버는 이미지 직접 업로드가 된다 → 인트로 붙은 download.mp4 대신 final.mp4 + 디자인 썸네일을 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 설명 칸 한도(화면 표기 0/300). */
export const CLIP_DESCRIPTION_MAX = 300;

/** 사장님이 올린 편과 같은 카테고리(화면 문구 — 스크립트가 이 글자로 메뉴를 고른다). */
export const CLIP_CATEGORY = { first: '리빙, 홈', second: '원예, 재배' } as const;

/** 클립 채널 페이지 — 개별 클립 주소 형식은 아직 확인 못 해서(카드가 a 링크가 아니다) 채널로 건다. */
export function clipProfileUrl(handle = 'bionditree'): string {
  return `https://clip.naver.com/@${handle}`;
}

/** 유튜브 전용 태그 — 클립에선 뜻이 없어 뺀다. */
const YOUTUBE_ONLY_TAGS = new Set(['shorts', 'youtubeshorts', '쇼츠', '유튜브쇼츠']);

const tagOf = (t: string): string => {
  const s = t.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return s && !YOUTUBE_ONLY_TAGS.has(s.toLowerCase()) ? `#${s}` : '';
};

/**
 * 설명 문구(순수) — 제목 / 본문 / 해시태그를 빈 줄로 잇고 300자 안에 넣는다.
 * 자를 때는 본문만 자른다. 제목과 해시태그는 검색·분류에 쓰여 남긴다. 그래도 넘치면 뒤쪽 태그부터 뺀다.
 */
export function buildClipDescription(title: string, body: string, hashtags: string[] = [], max = CLIP_DESCRIPTION_MAX): string {
  const head = title.trim();
  const tags: string[] = [];
  for (const t of hashtags.map(tagOf).filter(Boolean)) if (!tags.includes(t)) tags.push(t);
  const join = (parts: string[]): string => parts.filter(Boolean).join('\n\n');
  let tagLine = tags.join(' ');
  // 제목+태그만으로 넘치면 태그를 뒤에서부터 덜어낸다.
  while (tagLine && join([head, tagLine]).length > max) {
    tags.pop();
    tagLine = tags.join(' ');
  }
  const fixed = join([head, tagLine]);
  if (fixed.length > max) return head.slice(0, max);
  const text = body.trim();
  if (!text) return fixed;
  const full = join([head, text, tagLine]);
  if (full.length <= max) return full;
  // 본문 자리 = 한도 - (제목 + 태그 + 구분 빈 줄 둘). 말줄임표 한 글자 몫을 뺀다.
  const room = max - fixed.length - 2 - 1;
  if (room < 10) return fixed; // 본문을 몇 글자만 남기면 뜻이 안 통한다
  return join([head, `${text.slice(0, room).trimEnd()}…`, tagLine]);
}

/**
 * 클립에 올릴 영상(순수에 가까운 판정, 존재 확인만) — 원본 final.mp4 만 쓴다.
 * 저용량 preview.mp4(960p·CRF30, 발행 뒤 정리본)로 대신 올리지 않는다 — 화질이 눈에 띄게 떨어진다.
 * download.mp4 는 유튜브용(앞 1.6초 썸네일 인트로)이라 커버를 직접 지정하는 클립엔 맞지 않는다.
 */
export function pickClipVideo(dir: string): string | null {
  const p = path.join(dir, 'final.mp4');
  return fs.existsSync(p) ? p : null;
}

/** 블로그 글 주소 → logNo(순수). blog.naver.com/<id>/<logNo> 와 PostView.naver?logNo= 두 꼴. */
export function blogLogNoFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const q = /[?&]logNo=(\d{6,})/.exec(url);
  if (q) return q[1]!;
  const p = /blog\.naver\.com\/[^/?#]+\/(\d{6,})/.exec(url);
  return p ? p[1]! : null;
}

/** 이 편을 클립에 올릴 수 있는 채널인가(순수) — 유튜브용과 레거시(채널 미지정)만. 인스타용은 릴스 문법이다. */
export function canPublishClip(platform: string | undefined): boolean {
  return !platform || platform === 'youtube';
}

// ───────────────────── 검색 수요로 설명 첫 줄·해시태그 고르기(2026-10-05 사장님 승인) ─────────────────────
//
// 왜. 클립은 주로 검색으로 발견된다(통합검색 클립 칸, 클립 AI 브리핑이 자막·화면 글자를 읽는다). 그런데 설명 첫 줄은
// 우리가 지은 제목이고 해시태그는 대본 작가가 지은 말이라, 사람들이 실제로 치는 말과 어긋날 수 있다.
// 그래서 원본 블로그 글에 '실제로 들어온 검색어'(blog.stat 유입경로, 2026-10-02부터 수집)를 첫 줄과 태그에 쓴다.
// 우선순위: ① 그 글의 실제 검색 유입어 ② 글의 주 키워드 ③ 숏폼 해시태그. 새 글은 유입이 비어 ②·③으로 내려간다.
//
// 지키는 선(네이버는 키워드 나열을 스팸으로 본다):
//  · 첫 줄은 검색어 '하나'. 제목에 이미 들어 있으면 그다음 검색어를 보고, 다 들어 있으면 첫 줄을 안 붙인다.
//  · 해시태그 최대 5개. 남의 수종(감나무 글에 들어온 '배롱나무 끈적임')·브랜드·질문형 긴 문장·1글자는 뺀다.
//  · 글에 수종이 있으면 그 수종 이름이 든 검색어만 쓴다 — '나무 하얀가루'처럼 넓은 말은 이 글의 클립을 못 찾는다.
//    예외: 두 번 이상 들어온 검색어는 이름이 없어도 쓴다. 좀작살나무 글에 '보라색 알갱이'가 2번 들어왔다(10-04 실측) —
//    이름을 모르는 사람이 생김새로 찾는 말이라, 클립이 잡아야 할 바로 그 수요다. 1번짜리는 우연(남의 글 유입)과 못 가른다.

/** 해시태그 상한 — 사장님 확정(5개). */
export const CLIP_MAX_HASHTAGS = 5;
/** 첫 줄 검색어 최대 글자(질문형 긴 유입어를 거른다 — '감나무 가지 끝쪽 아래에 하얀 가루 같은 것이…'). */
const LEAD_MAX = 20;
/** 해시태그 최대 글자(공백 뺀 뒤). */
const TAG_MAX = 15;
/** 브랜드·판매처·플랫폼 이름이 든 검색어 — 남의 가게 이름을 우리 클립 태그로 쓰지 않는다. */
const BRAND_JUNK = /(비온디|biondi|농장|농원|종묘|화원|쿠팡|네이버|블로그|유튜브|스토어|마켓|쇼핑)/i;

/** 수종 판정에 쓰는 최소 꼴(species.ts 의 Species 와 맞물린다 — 테스트가 작은 표를 넘길 수 있게 구조만 받는다). */
export interface ClipSpecies { readonly name: string; readonly aliases?: readonly string[] }

export interface ClipSearchInput {
  title: string;
  body: string;
  /** 숏폼 해시태그(③순위). */
  hashtags?: readonly string[];
  /** 원본 글의 주 키워드(②순위). */
  keyword?: string;
  /** 원본 글의 실제 검색 유입어 — topInflow 결과처럼 많이 들어온 순(①순위). */
  inflow?: ReadonlyArray<{ keyword: string; count: number }>;
  /** 이 글의 수종(없으면 키워드 낱말로 관련성을 본다). */
  species?: ClipSpecies;
  /** 수종 사전 전체 — '남의 수종' 판정용. */
  speciesList?: readonly ClipSpecies[];
}

const squash = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** 이 수종을 부르는 말들(이름·별칭 + 끝 '나무'를 뗀 2자 이상 어간 — '하스카프나무'→'하스카프'). */
function ownNames(sp: ClipSpecies): string[] {
  const out = new Set<string>();
  for (const n of [sp.name, ...(sp.aliases ?? [])]) {
    if (!n) continue;
    out.add(n);
    if (n.endsWith('나무') && n.length - 2 >= 2) out.add(n.slice(0, -2));
  }
  return [...out];
}

/** 글에 든 수종 이름 중 이 글의 수종이 아닌 것이 있는가(긴 이름 우선 — '흰배롱나무' 안의 '배롱나무'는 따로 안 센다). */
function namesOtherSpecies(text: string, own: ClipSpecies | undefined, list: readonly ClipSpecies[]): boolean {
  if (!own) return false; // 수종 없는 글('7월에 심는 꽃')은 남의 수종이 따로 없다 — 관련성은 키워드 낱말로 본다
  const mine = new Set(own ? [own.name, ...(own.aliases ?? [])] : []);
  const keys = list.flatMap((sp) => [sp.name, ...(sp.aliases ?? [])].map((k) => ({ k, sp })))
    .filter((x) => x.k).sort((a, b) => b.k.length - a.k.length);
  const taken: Array<[number, number]> = [];
  for (const { k, sp } of keys) {
    for (let at = text.indexOf(k); at >= 0; at = text.indexOf(k, at + 1)) {
      const end = at + k.length;
      if (taken.some(([s, e]) => at < e && s < end)) continue;
      taken.push([at, end]);
      if (!mine.has(k) && sp.name !== own.name) return true;
    }
  }
  return false;
}

/** 이 글과 관련된 검색어인가 — 수종이 있으면 그 이름이 들어야 하고, 없으면 키워드 낱말(2자 이상) 하나는 겹쳐야 한다.
 *  두 번 이상 들어온 유입어(count ≥ 2)는 그것만으로 이 글의 수요로 본다. */
function relevant(q: string, input: ClipSearchInput, count = 0): boolean {
  if (count >= 2) return true;
  if (input.species) {
    const sq = squash(q);
    return ownNames(input.species).some((n) => sq.includes(squash(n)));
  }
  const words = String(input.keyword ?? '').split(/\s+/).filter((w) => w.length >= 2);
  return !words.length || words.some((w) => q.includes(w));
}

/** 쓸 만한 검색어인가(공통 거름망) — 길이·브랜드·남의 수종·관련성. */
function usable(q: string, input: ClipSearchInput, count = 0): boolean {
  if (squash(q).length < 2) return false;
  if (BRAND_JUNK.test(q)) return false;
  if (namesOtherSpecies(q, input.species, input.speciesList ?? [])) return false;
  return relevant(q, input, count);
}

/** 해시태그 꼴로(순수) — 공백·기호를 빼고 한글·영문·숫자만. 유튜브 전용 태그·너무 긴 것은 ''. */
function asTag(raw: string): string {
  const s = raw.trim().replace(/^#+/, '').replace(/[^0-9A-Za-z가-힣_]/g, '');
  if (s.length < 2 || s.length > TAG_MAX) return '';
  return YOUTUBE_ONLY_TAGS.has(s.toLowerCase()) ? '' : s;
}

/**
 * 설명 첫 줄 검색어와 해시태그를 고른다(순수).
 * lead = 제목에 아직 없는 가장 많이 들어온 검색어(없으면 주 키워드), tags = 유입어 → 키워드 → 숏폼 태그 순 최대 5개.
 */
export function pickClipSearchTerms(input: ClipSearchInput): { lead?: string; tags: string[] } {
  const inflow = (input.inflow ?? [])
    .map((x) => ({ q: String(x.keyword ?? '').trim().replace(/\s+/g, ' '), n: Number(x.count) || 0 }))
    .filter((x) => x.q && usable(x.q, input, x.n))
    .map((x) => x.q);
  const keyword = String(input.keyword ?? '').trim().replace(/\s+/g, ' ');
  const title = squash(input.title);
  const leadPool = [...inflow, ...(keyword && usable(keyword, input) ? [keyword] : [])]
    .filter((q) => q.length <= LEAD_MAX);
  const lead = leadPool.find((q) => !title.includes(squash(q)));

  const tags: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string, check: boolean): void => {
    if (tags.length >= CLIP_MAX_HASHTAGS) return;
    if (check && !usable(raw, input)) return;
    const t = asTag(raw);
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    tags.push(`#${t}`);
  };
  for (const q of inflow) push(q, false); // 위에서 이미 걸렀다(횟수 예외 포함)
  if (keyword) push(keyword, true);
  // 숏폼 태그는 관련성 검사를 하지 않는다('#정원수' 같은 넓은 말도 작가가 고른 분류어다) — 브랜드·남의 수종만 뺀다.
  for (const h of input.hashtags ?? []) {
    const raw = h.replace(/^#+/, '');
    if (BRAND_JUNK.test(raw) || namesOtherSpecies(raw, input.species, input.speciesList ?? [])) continue;
    push(raw, false);
  }
  return { ...(lead ? { lead } : {}), tags };
}

/**
 * 클립 설명(순수) — [검색어]\n제목 / 본문 / 해시태그. 자르기 규칙은 buildClipDescription 그대로(본문만 자른다).
 * 검색어와 제목은 한 덩어리(줄바꿈 하나)로 둔다 — 중복 공개 검사가 제목 '줄'로 같은 편을 찾는다(naver_clip_publish.py).
 */
export function buildClipSearchDescription(input: ClipSearchInput, max = CLIP_DESCRIPTION_MAX): string {
  const { lead, tags } = pickClipSearchTerms(input);
  const title = input.title.trim();
  const head = lead ? `${lead}\n${title}` : title;
  return buildClipDescription(head, input.body, tags, max);
}

/** 이번 실행에 쓸 클립 설명(순수, 리뷰 2026-10-05) — 지난번 '등록'에 쓴 설명이 저장돼 있으면 확인·재업로드 모두 그 글자를
 *  그대로 쓴다. 설명 첫 줄은 검색 유입으로 매일 바뀌어, 새로 만들면 전체 설명 중복 검사(find_published)가 지난 시도의 클립을
 *  못 알아본다(같은 편이 두 번 공개될 수 있다). 드라이런은 미리보기라 새로 만든 설명. */
export function pickClipDescription(built: string, stored: string | undefined, dryRun: boolean): string {
  return !dryRun && stored?.trim() ? stored : built;
}

/** 수종 재생목록 이름(순수) — "<수종> 키우기". 수종을 모르면 undefined(지어내지 않는다). */
export function clipPlaylistName(species: ClipSpecies | undefined): string | undefined {
  return species?.name ? `${species.name} 키우기` : undefined;
}

/**
 * 클립 올리기 권유를 보낼 편인가(순수, 2026-10-05) — 블로그 발행이 감지된 글의 유튜브용 완성 편.
 * 한 편에 한 번만(naverClipNudgedTs). 이미 올라갔거나 '등록 뒤 미확인'·대기·업로드 중이면 보내지 않는다.
 * 원본(final.mp4)이 정리됐으면 눌러도 409 라 보내지 않는다.
 */
export function clipNudgeDue(
  s: { stage?: string; platform?: string; naverClipNo?: string; naverClipSubmittedTs?: string; naverClipQueuedTs?: string; naverClipNudgedTs?: string },
  ctx: { hasFinal: boolean; inFlight: boolean },
): boolean {
  if (s.stage !== 'ready' || !canPublishClip(s.platform)) return false;
  if (s.naverClipNo || s.naverClipSubmittedTs || s.naverClipQueuedTs || s.naverClipNudgedTs) return false;
  return ctx.hasFinal && !ctx.inFlight;
}
