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
