import { describe, expect, it } from 'vitest';
import { LABEL_MAX_KO, LABEL_MAX_NUMERIC, SAFE, atFromWords, beat, beatInOut, clampLabel, labelLen, textWidth } from './sceneUtil';

describe('labelLen', () => {
  it('한글 라벨은 공백 빼고 8자까지', () => {
    expect(labelLen('물 빠짐 구멍')).toMatchObject({ ok: true, len: 5, limit: LABEL_MAX_KO });
    expect(labelLen('피트모스 절반↑')).toMatchObject({ ok: true, len: 7 });
    expect(labelLen('뿌리를 살짝 풀어 주세요').ok).toBe(false);
  });
  it('숫자 라벨은 12자까지', () => {
    expect(labelLen('pH 4.5~5.5')).toMatchObject({ ok: true, numeric: true, limit: LABEL_MAX_NUMERIC });
    expect(labelLen('30cm')).toMatchObject({ ok: true, len: 4 });
    expect(labelLen('지름 30cm 이상 화분 고르기').ok).toBe(false);
  });
  it('빈 라벨은 거절', () => expect(labelLen('  ').ok).toBe(false));
});

describe('clampLabel', () => {
  it('왼쪽 가장자리 넘는 가운데 정렬 라벨을 안으로 민다', () => {
    const r = clampLabel(10, 10, '산성 흙', 40, 'middle');
    const w = textWidth('산성 흙', 40) + 40 * 0.24;
    expect(r.x - w / 2).toBeGreaterThanOrEqual(SAFE.x0 - 1e-9);
    expect(r.y - 40).toBeGreaterThanOrEqual(SAFE.y0 - 1e-9);
  });
  it('오른쪽 끝 start 정렬도 넘지 않는다', () => {
    const r = clampLabel(990, 600, 'pH 4.5~5.5', 36, 'start');
    expect(r.x + textWidth('pH 4.5~5.5', 36) + 36 * 0.24).toBeLessThanOrEqual(SAFE.x1 + 1e-9);
    expect(r.y).toBeLessThanOrEqual(SAFE.y1);
  });
  it('안에 있으면 그대로', () => expect(clampLabel(500, 300, '원래 깊이', 32)).toEqual({ x: 500, y: 300 }));
});

describe('beat', () => {
  it('at 전 0, at+dur 뒤 1, 단조 증가', () => {
    expect(beat(0, 10, 20)).toBe(0);
    expect(beat(40, 10, 20)).toBe(1);
    expect(beat(15, 10, 20)).toBeLessThan(beat(20, 10, 20));
  });
  it('beatInOut 은 until 뒤 꺼진다', () => {
    expect(beatInOut(30, 0, 60)).toBe(1);
    expect(beatInOut(80, 0, 60)).toBe(0);
    expect(beatInOut(80, 0)).toBe(1);
  });
});

describe('atFromWords', () => {
  const words = [{ w: '블루베리는', start: 0.1 }, { w: '피트모스를', start: 1.5 }, { w: '절반', start: 2.0 }, { w: '피트모스가', start: 4.0 }];
  it('조사가 붙어도 찾고, lead 만큼 앞당긴다', () => {
    expect(atFromWords(words, '피트모스', 30)).toBe(45 - 4);
    expect(atFromWords(words, '피트모스', 30, 0, { lead: 0 })).toBe(45);
  });
  it('nth 로 두 번째', () => expect(atFromWords(words, '피트모스', 30, 0, { nth: 1, lead: 0 })).toBe(120));
  it('없으면 fallback, NaN 금지', () => {
    expect(atFromWords(words, 'pH', 30, 77)).toBe(77);
    expect(atFromWords(undefined, '절반', 30, 5)).toBe(5);
    expect(atFromWords([{ w: '절반', start: Number.NaN }], '절반', 30, 9)).toBe(9);
  });
});
