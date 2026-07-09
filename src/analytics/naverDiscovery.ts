/**
 * 네이버 발행 자동 감지 — 임시저장된 piece 가 사람 손으로 발행되면 블로그 공개 RSS 에서
 * 제목 매칭으로 최종 URL 을 찾아 publishedUrl 을 자동 설정한다(성과 수집기의 기동 조건).
 * 보수적 매칭(정규화 exact + 시각 조건 + 양방향 유일)만 자동 — 모호하면 피드 안내 후 수동 폴백.
 * 전량 fail-open: 어떤 실패도 이어지는 성과 동기화를 깨지 않는다.
 * 스펙: docs/superpowers/specs/2026-07-10-naver-publish-discovery-design.md
 */

export interface RssItem { title: string; link: string; pubDate: string /* ISO */ }

/** HTML 엔티티 디코드 — 숫자(10/16진) → named 4종 → &amp; 마지막(이중 디코드 방지). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d: string) => { try { return String.fromCodePoint(Number(d)); } catch { return ''; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** NFC 정규화 + 엔티티 디코드 + 공백(개행 포함) 1칸 축약 + 트림 — 매칭 전 제목 표준형(순수). */
export function normalizeTitle(s: string): string {
  return decodeEntities(String(s)).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** RSS 2.0 XML → 아이템 배열(정규식 파싱 — 의존성 0, 순수). CDATA·이형 방어, 이형이면 빈 배열(throw 금지).
 *  title 은 원문 보존(엔티티 디코드는 매칭 시 normalizeTitle 이 양쪽에 적용). pubDate 는 ISO 로 정규화. */
export function parseRssItems(xml: string): RssItem[] {
  const out: RssItem[] = [];
  if (typeof xml !== 'string' || !xml.includes('<item')) return out;
  for (const it of xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []) {
    const field = (tag: string): string => {
      const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!m) return '';
      const raw = m[1] ?? '';
      const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      return (cdata ? cdata[1] ?? '' : raw).trim();
    };
    const title = field('title');
    const link = field('link');
    const t = Date.parse(field('pubDate'));
    if (!title || !link || !Number.isFinite(t)) continue;
    out.push({ title, link, pubDate: new Date(t).toISOString() });
  }
  return out;
}
