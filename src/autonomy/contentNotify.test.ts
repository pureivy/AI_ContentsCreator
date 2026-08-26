import { describe, it, expect } from 'vitest';
import {
  escapeHtml, stripMarkdown, reviewLink, studioBase,
  blogReadyHtml, cardnewsCaptionHtml, shortsCaptionHtml, factGateLines,
} from './contentNotify';

describe('escapeHtml', () => {
  it('&·<·> 를 이스케이프한다(텔레그램 HTML parse_mode 안전)', () => {
    expect(escapeHtml('<b>A&B</b>')).toBe('&lt;b&gt;A&amp;B&lt;/b&gt;');
  });
});

describe('stripMarkdown', () => {
  it('이미지·링크·헤더·강조·코드펜스를 제거하고 평문만 남긴다', () => {
    const md = '# 제목\n\n![alt](http://x/img.png)\n**굵게** 그리고 [링크](http://y)\n\n```js\ncode();\n```\n본문.';
    const out = stripMarkdown(md);
    expect(out).not.toContain('#');
    expect(out).not.toContain('![');
    expect(out).not.toContain('http://y');
    expect(out).not.toContain('code()');
    expect(out).toContain('제목');
    expect(out).toContain('굵게 그리고 링크');
    expect(out).toContain('본문.');
  });
});

describe('reviewLink', () => {
  it('piece id 가 있으면 ?piece= 딥링크, 없으면 스튜디오 홈', () => {
    expect(reviewLink('piece_ab12')).toBe(`${studioBase()}/?piece=piece_ab12`);
    expect(reviewLink(undefined)).toBe(`${studioBase()}/`);
  });
});

describe('blogReadyHtml', () => {
  it('제목·키워드·SEO·발췌·검토 링크를 담는다', () => {
    const html = blogReadyHtml(
      { id: 'piece_x', title: '블루베리 & 관리', keyword: '블루베리키우기', seoScore: 87, brand: 'bionditree' },
      '본문 발췌입니다',
    );
    expect(html).toContain('블로그 초안 검토 대기 · bionditree');
    expect(html).toContain('<b>블루베리 &amp; 관리</b>'); // 제목의 & 이스케이프
    expect(html).toContain('블루베리키우기 · SEO 87점');
    expect(html).toContain('본문 발췌입니다');
    expect(html).toContain('?piece=piece_x');
  });

  it('메타·발췌가 비면 해당 줄을 생략하고, 제목 없으면 미정 표기', () => {
    const html = blogReadyHtml({ id: 'p1' }, '');
    expect(html).toContain('(제목 미정)');
    expect(html).not.toContain('SEO');
    expect(html).toContain(`${studioBase()}/?piece=p1`);
  });

  it('개정 런이면 ↻ 개정본 라벨 — 원본 알림과 구분(중복 오해 방지)', () => {
    expect(blogReadyHtml({ id: 'p1', revised: true }, '')).toContain('↻ 블로그 개정본 검토 대기');
    expect(blogReadyHtml({ id: 'p1' }, '')).toContain('📝 블로그 초안 검토 대기');
  });

  it('브랜드 슬러그도 이스케이프한다(자유 문자열 — & 포함 가능)', () => {
    expect(blogReadyHtml({ id: 'p1', brand: 'a&b' }, '')).toContain('검토 대기 · a&amp;b');
  });
});

describe('cardnewsCaptionHtml', () => {
  it('주제·장수·담당·원본 piece 딥링크를 담는다', () => {
    const cap = cardnewsCaptionHtml({
      id: 'card_1', topic: '하스카프베리 <두 품종>', brand: 'bionditree', slides: 7,
      sourcePieceId: 'piece_src', planner: '김도현', designer: '오세라',
    });
    expect(cap).toContain('카드뉴스 검토 대기 · bionditree');
    expect(cap).toContain('&lt;두 품종&gt;'); // 주제 이스케이프
    expect(cap).toContain('7장 · 김도현·오세라');
    expect(cap).toContain('?piece=piece_src');
  });

  it('독립 생성(원본 piece 없음)이면 스튜디오 홈 링크', () => {
    expect(cardnewsCaptionHtml({ id: 'c', topic: 'T' })).toContain(`${studioBase()}/`);
  });
});

describe('shortsCaptionHtml', () => {
  it('주제·길이·씬 수·담당·딥링크를 담는다', () => {
    const cap = shortsCaptionHtml({
      id: 'short_1', topic: '라벨 확인법', brand: 'bionditree', durationSec: 42, scenes: 6,
      sourcePieceId: 'piece_src', writer: '서다인',
    });
    expect(cap).toContain('쇼츠 검토 대기 · bionditree');
    expect(cap).toContain('42초 · 씬 6개 · 서다인');
    expect(cap).toContain('?piece=piece_src');
  });
});

describe('factGateLines — 텔레그램 보류 표시(스펙 §2-3)', () => {
  it('hold 면 건수와 문장(80자 절단)을 최대 N개', () => {
    const s = factGateLines({ status: 'hold', unsupported: ['a'.repeat(100), 'b'], contradicted: ['c ← 근거: d'], checkedTs: 't' }, 2);
    expect(s.split('\n')[0]).toBe('⚠ 사실 게이트 보류 3건 — 근거 없음 2 · 모순 1');
    expect(s).toContain('• ' + 'a'.repeat(80) + '…');
    expect(s).toContain('• b');
    expect(s).not.toContain('• c ←'); // maxItems 2 — 세 번째 항목은 잘린다
  });
  it('error 는 판정 실패로, pass·미실행은 빈 문자열', () => {
    expect(factGateLines({ status: 'error', unsupported: [], contradicted: [], checkedTs: 't' }, 3)).toBe('⚠ 사실 게이트 판정 실패 — 수동 검토 필요');
    expect(factGateLines({ status: 'pass', unsupported: [], contradicted: [], checkedTs: 't' }, 3)).toBe('');
    expect(factGateLines(undefined, 3)).toBe('');
  });
  it('블로그 메시지·카드 캡션에 들어간다(HTML 이스케이프)', () => {
    const fg = { status: 'hold' as const, unsupported: ['5cm <두께>'], contradicted: [], checkedTs: 't' };
    expect(blogReadyHtml({ id: 'p1', title: 'T', factGate: fg }, '')).toContain('5cm &lt;두께&gt;');
    expect(cardnewsCaptionHtml({ id: 'c1', topic: 'T', factGate: fg })).toContain('⚠ 원문 정합 보류 1건');
  });
});
