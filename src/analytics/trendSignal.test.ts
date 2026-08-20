import { describe, it, expect } from 'vitest';
import { buildTrendBlock, type TrendSnap } from './trendSignal';

const NOW = new Date('2026-08-20T12:00:00').getTime();

describe('buildTrendBlock — 자동완성 스냅샷 diff 블록(순수)', () => {
  it('직전 스냅샷에 없던 연관어에 ★를 붙인다', () => {
    const snap: TrendSnap = {
      date: '2026-08-20',
      entries: { 배롱나무: ['배롱나무 가지치기', '배롱나무 단풍'] },
      prevDate: '2026-08-19',
      prevEntries: { 배롱나무: ['배롱나무 가지치기'] },
    };
    const block = buildTrendBlock(snap, NOW);
    expect(block).toContain('배롱나무 가지치기');
    expect(block).not.toContain('★배롱나무 가지치기');
    expect(block).toContain('★배롱나무 단풍');
    expect(block).toContain('2026-08-19');
  });
  it('직전 스냅샷이 없으면 ★ 없이 목록만 준다(첫 수집일)', () => {
    const block = buildTrendBlock({ date: '2026-08-20', entries: { 조경수: ['조경수 추천'] } }, NOW);
    expect(block).toContain('조경수 추천');
    expect(block).not.toContain('★');
  });
  it('낡은 스냅샷(7일 초과)·null 은 빈 문자열(무주입)', () => {
    expect(buildTrendBlock({ date: '2026-08-01', entries: { a: ['b'] } }, NOW)).toBe('');
    expect(buildTrendBlock(null, NOW)).toBe('');
  });
});
