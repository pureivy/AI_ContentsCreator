import { describe, expect, it } from 'vitest';
import { buildChapters, buildYoutubeDescription, buildYoutubeMeta, fmtChapterTime, YT_DESC_MAX } from './youtubeMeta';
import { CHAPTER_ORDER, type Chapter } from './script';

const chapters: Chapter[] = CHAPTER_ORDER.map((id) => ({ id, title: `${id} 제목`, segments: [] }));
const starts = (title: (id: string) => string = (id) => `${id} 제목`) =>
  CHAPTER_ORDER.map((id, i) => ({ id, title: title(id), startFrame: i * 900, frames: 60 }));

describe('fmtChapterTime', () => {
  it('m:ss, 1시간 이상은 h:mm:ss', () => {
    expect(fmtChapterTime(0)).toBe('0:00');
    expect(fmtChapterTime(65.9)).toBe('1:05');
    expect(fmtChapterTime(600)).toBe('10:00');
    expect(fmtChapterTime(3725)).toBe('1:02:05');
  });
});

describe('buildChapters', () => {
  it('ytLabel 우선, 수종 장은 수종 이름·일반 장은 과일나무 접두', () => {
    const cs = chapters.map((c) => (c.id === 'gam' ? { ...c, ytLabel: '감 정리' } : c));
    const { lines } = buildChapters(starts(), cs, 30, 7 * 900);
    expect(lines[0]).toBe('0:00 과일나무 intro 제목');
    expect(lines[2]).toBe('1:00 매실나무 maesil 제목');
    expect(lines[4]).toBe('2:00 감 정리');
  });
  it('제목에 수종·과일나무가 이미 있으면 덧붙이지 않는다', () => {
    const t = (id: string) => ({ maesil: '매실 — 굵은 가지', gam: '감나무 — 미룹니다', intro: '과일나무 시작' } as Record<string, string>)[id] ?? `${id} 제목`;
    const { lines } = buildChapters(starts(t), chapters, 30, 7 * 900);
    expect(lines[2]).toBe('1:00 매실 — 굵은 가지');
    expect(lines[4]).toBe('2:00 감나무 — 미룹니다');
    expect(lines[0]).toBe('0:00 과일나무 시작');
  });
  it('첫 챕터는 0:00 으로 강제하고 문제로 알린다', () => {
    const s = starts().map((c) => ({ ...c, startFrame: c.startFrame + 30 }));
    const r = buildChapters(s, chapters, 30, 7 * 900 + 30);
    expect(r.lines[0]!.startsWith('0:00 ')).toBe(true);
    expect(r.problems.some((p) => p.includes('0:00'))).toBe(true);
  });
  it('3개 미만·10초 미만 챕터는 problems', () => {
    expect(buildChapters(starts().slice(0, 2), chapters, 30, 5000).problems.some((p) => p.includes('3개'))).toBe(true);
    const short = starts().map((c, i) => ({ ...c, startFrame: i * 200 }));
    expect(buildChapters(short, chapters, 30, 7 * 200).problems.some((p) => p.includes('10초'))).toBe(true);
    expect(buildChapters(starts(), chapters, 30, 7 * 900).problems).toEqual([]);
  });
});

describe('buildYoutubeDescription', () => {
  const base = { keyLine: '과실나무 겨울 전정', chapters: ['0:00 가', '1:00 나', '2:00 다'], hashtags: ['전정', '#겨울'] };
  it('첫 줄은 keyLine, 이어서 챕터·링크·해시태그', () => {
    const d = buildYoutubeDescription({ ...base, blogUrl: 'https://x.kr/1' });
    const lines = d.split('\n');
    expect(lines[0]).toBe('과실나무 겨울 전정');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('챕터');
    expect(d).toContain('블로그 글: https://x.kr/1');
    expect(lines.at(-1)).toBe('#전정 #겨울');
  });
  it('< > 제거, 5000자 상한', () => {
    expect(buildYoutubeDescription({ ...base, keyLine: 'a<b>c' })).toMatch(/^abc\n/);
    expect(buildYoutubeDescription({ ...base, keyLine: 'x'.repeat(6000) }).length).toBe(YT_DESC_MAX);
  });
});

describe('buildChapters — 대본이 정한 장(2026-10-22)', () => {
  it('ytLabel 없고 species 가 있으면 수종 접두, species 빈 배열(일반 장)은 장 제목 그대로', () => {
    const cs: Chapter[] = [
      { id: 'intro', title: '가을에 심는 이유', species: [], segments: [] },
      { id: 'apple', title: '심는 깊이', species: ['사과나무'], segments: [] },
      { id: 'pear', title: '배나무 자리', species: ['배나무'], segments: [] },
    ];
    const st = cs.map((c, i) => ({ id: c.id, title: c.title, startFrame: i * 900, frames: 60 }));
    expect(buildChapters(st, cs, 30, 3 * 900).lines).toEqual(['0:00 가을에 심는 이유', '0:30 사과나무 심는 깊이', '1:00 배나무 자리']);
  });
});

describe('buildYoutubeMeta·buildYoutubeTags', () => {
  it('해시태그(# 뗌)와 장 대표 수종으로 태그, 설명엔 챕터', () => {
    const cs: Chapter[] = [
      { id: 'intro', title: '시작', species: [], segments: [] },
      { id: 'apple', title: '사과', species: ['사과나무'], segments: [] },
      { id: 'outro', title: '정리', species: [], segments: [] },
    ];
    const tl = { chapterStarts: cs.map((c, i) => ({ id: c.id, title: c.title, startFrame: i * 900, frames: 60 })), totalFrames: 2700 };
    const m = buildYoutubeMeta({ title: '사과나무 심기', ytKeyLine: '핵심 줄', ytHashtags: ['#사과나무', '가을 심기'], chapters: cs }, tl);
    expect(m.title).toBe('사과나무 심기');
    expect(m.tags).toEqual(['사과나무', '가을심기']);
    expect(m.description.startsWith('핵심 줄')).toBe(true);
    expect(m.description).toContain('0:30 사과\n'); // 제목에 수종 어간이 있으면 접두를 붙이지 않는다
    expect(m.problems).toEqual([]);
  });
});
