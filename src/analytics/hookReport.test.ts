import { describe, it, expect } from 'vitest';
import { median, ratioOf, segmentByYoutubeTs, sixHourViewsIfEligible, sixHour400PlusRatio } from './hookReport';

describe('median (중앙값)', () => {
  it('빈 배열 → null', () => {
    expect(median([])).toBeNull();
  });
  it('홀수 개 → 가운데 값', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  it('짝수 개 → 가운데 두 값의 평균', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('ratioOf (비율)', () => {
  it('빈 배열 → null(표본 0)', () => {
    expect(ratioOf([])).toBeNull();
  });
  it('참 개수 / 전체', () => {
    expect(ratioOf([true, true, false, false])).toBe(0.5);
    expect(ratioOf([true, true, true])).toBe(1);
    expect(ratioOf([false])).toBe(0);
  });
});

// since 기준 '배포 전 30일'([since-30일, since))과 '배포 후'([since, ∞)) — youtubeTs 없는 편은 제외.
describe('segmentByYoutubeTs (구간 나누기)', () => {
  const since = Date.parse('2026-09-18T00:00:00+09:00');
  it('경계값 포함 규칙 — since 당일은 배포 후, since-30일 당일은 배포 전, 그 이전은 어느 쪽도 아님', () => {
    const rows = [
      { id: 'onBoundary', youtubeTs: new Date(since).toISOString() },            // since 자체 → after
      { id: 'justBefore', youtubeTs: new Date(since - 1).toISOString() },        // since 1ms 전 → before
      { id: 'thirtyDaysBefore', youtubeTs: new Date(since - 30 * 86_400_000).toISOString() }, // 경계 포함 → before
      { id: 'tooOld', youtubeTs: new Date(since - 30 * 86_400_000 - 1).toISOString() },       // 30일 초과 → 제외
      { id: 'noTs' },                                                            // youtubeTs 없음 → 제외
    ];
    const { before, after } = segmentByYoutubeTs(rows, since);
    expect(after.map((r) => r.id)).toEqual(['onBoundary']);
    expect(before.map((r) => r.id)).toEqual(['justBefore', 'thirtyDaysBefore']);
  });
  it('youtubeTs 파싱 불가는 조용히 제외(부실 데이터 방어)', () => {
    const rows = [{ id: 'bad', youtubeTs: 'not-a-date' }, { id: 'ok', youtubeTs: new Date(since).toISOString() }];
    const { before, after } = segmentByYoutubeTs(rows, since);
    expect(before).toEqual([]);
    expect(after.map((r) => r.id)).toEqual(['ok']);
  });
});

describe('sixHourViewsIfEligible (5~7h 창 조회수)', () => {
  const pub = '2026-09-01T00:00:00Z';
  it('창 밖 표본만 있으면 null', () => {
    const samples = [{ measuredAt: '2026-09-01T04:00:00Z', views: 100 }, { measuredAt: '2026-09-01T08:00:00Z', views: 500 }];
    expect(sixHourViewsIfEligible(pub, samples)).toBeNull();
  });
  it('창 안 표본이 여러 개면 가장 늦은(6h 에 가까운) 값', () => {
    const samples = [
      { measuredAt: '2026-09-01T05:30:00Z', views: 200 },
      { measuredAt: '2026-09-01T06:30:00Z', views: 350 },
      { measuredAt: '2026-09-01T09:00:00Z', views: 999 }, // 창 밖 — 무시
    ];
    expect(sixHourViewsIfEligible(pub, samples)).toBe(350);
  });
  it('metaPublishedTs 파싱 불가 → null', () => {
    expect(sixHourViewsIfEligible('not-a-date', [{ measuredAt: '2026-09-01T06:00:00Z', views: 1 }])).toBeNull();
  });
});

describe('sixHour400PlusRatio (6h 400+ 비율)', () => {
  const at = (h: number): string => new Date(Date.parse('2026-09-01T00:00:00Z') + h * 3_600_000).toISOString();
  it('창 표본 있는 편이 5편 미만이면 판정 보류(ratio: null) — eligible 은 실제 표본 수를 그대로 밝힌다', () => {
    const rows = Array.from({ length: 4 }, () => ({ metaPublishedTs: '2026-09-01T00:00:00Z', samples: [{ measuredAt: at(6), views: 500 }] }));
    expect(sixHour400PlusRatio(rows)).toEqual({ ratio: null, eligible: 4 });
  });
  it('5편 이상이면 400+ 비율 계산 — 분모(eligible)는 창 표본 있는 편만', () => {
    const eligible = [500, 300, 400, 999, 10].map((views) => ({ metaPublishedTs: '2026-09-01T00:00:00Z', samples: [{ measuredAt: at(6), views }] }));
    const noWindow = { metaPublishedTs: '2026-09-01T00:00:00Z', samples: [{ measuredAt: at(20), views: 100_000 }] }; // 창 밖 — 분모 제외
    const noPub = { samples: [{ measuredAt: at(6), views: 100_000 }] }; // metaPublishedTs 없음 — 제외
    expect(sixHour400PlusRatio([...eligible, noWindow, noPub])).toEqual({ ratio: 3 / 5, eligible: 5 }); // 500·400·999 만 400+
  });
});
