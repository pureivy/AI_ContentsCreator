import { describe, it, expect } from 'vitest';
import { parseRssItems, normalizeTitle } from './naverDiscovery';

// 실 네이버 RSS 2.0 형태 축약 픽스처 — 평문 제목·CDATA 제목·엔티티·이형 아이템 혼재.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>테스트 블로그</title>
<link>https://blog.naver.com/testblog</link>
<item>
<title>경북 소상공인 지원금 총정리</title>
<link>https://blog.naver.com/testblog/223900000001</link>
<description>본문 요약</description>
<pubDate>Thu, 09 Jul 2026 10:30:00 +0900</pubDate>
</item>
<item>
<title><![CDATA[카드뉴스 &amp; 숏폼 활용법]]></title>
<link>https://blog.naver.com/testblog/223900000002</link>
<pubDate>Thu, 09 Jul 2026 11:00:00 +0900</pubDate>
</item>
<item>
<title>pubDate 이상 아이템</title>
<link>https://blog.naver.com/testblog/223900000003</link>
<pubDate>날짜아님</pubDate>
</item>
<item>
<title>링크 없는 아이템</title>
<pubDate>Thu, 09 Jul 2026 12:00:00 +0900</pubDate>
</item>
</channel>
</rss>`;

describe('parseRssItems — RSS 2.0 파싱(순수·이형 방어)', () => {
  it('정상 아이템만 추출, pubDate 는 ISO 로 정규화', () => {
    const items = parseRssItems(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: '경북 소상공인 지원금 총정리',
      link: 'https://blog.naver.com/testblog/223900000001',
      pubDate: new Date('2026-07-09T10:30:00+09:00').toISOString(),
    });
    expect(items[1]!.title).toBe('카드뉴스 &amp; 숏폼 활용법'); // CDATA 원문 보존(디코드는 normalizeTitle 몫)
  });
  it('이형 입력은 빈 배열 — throw 금지', () => {
    expect(parseRssItems('')).toEqual([]);
    expect(parseRssItems('완전 엉뚱한 문자열')).toEqual([]);
    expect(parseRssItems('<rss><channel><item><title>닫히지 않은')).toEqual([]);
  });
});

describe('normalizeTitle — NFC·엔티티·공백(순수)', () => {
  it('HTML 엔티티 디코드(named+숫자) 후 공백 축약·트림', () => {
    expect(normalizeTitle('카드뉴스 &amp; 숏폼 활용법')).toBe('카드뉴스 & 숏폼 활용법');
    expect(normalizeTitle('&quot;따옴표&quot; &#39;홑&#39; &#x27;헥스&#x27;')).toBe(`"따옴표" '홑' '헥스'`);
    expect(normalizeTitle('  앞뒤\n개행\t탭  ')).toBe('앞뒤 개행 탭');
  });
  it('NFC 정규화 — NFD 한글과 NFC 한글이 같은 표준형', () => {
    expect(normalizeTitle('가나다'.normalize('NFD'))).toBe('가나다');
  });
  it('&amp;lt; 는 이중 디코드하지 않는다(&amp; 를 마지막에 처리)', () => {
    expect(normalizeTitle('a &amp;lt; b')).toBe('a &lt; b');
  });
});
