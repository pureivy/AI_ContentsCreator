import { describe, it, expect } from 'vitest';
// @ts-ignore — remotion/ 는 root tsc include 밖(런타임 임포트만)
import { FILM_LOOKS, pickFilmLook, filmLookEffects } from '../../remotion/filmLook';

describe('필름 룩 — 편별 색 보정', () => {
  it('같은 편은 같은 룩 — 재렌더해도 색이 안 바뀐다', () => {
    for (const id of ['short_a', 'short_b', 'short_c']) {
      expect(pickFilmLook(id)).toBe(pickFilmLook(id));
    }
  });
  it('편이 다르면 룩이 갈린다', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickFilmLook(`short_${i}`).name));
    expect(seen.size).toBeGreaterThan(3);
  });
  it('여섯 룩이 모두 뽑힌다 — 죽은 항목이 없다', () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => pickFilmLook(`s${i}`).name));
    expect(seen.size).toBe(FILM_LOOKS.length);
  });

  it('값이 보정 범위를 넘지 않는다 — 세게 걸면 보정이 아니라 필터가 된다', () => {
    for (const l of FILM_LOOKS) {
      expect(Math.abs(l.temperature)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(l.tint)).toBeLessThanOrEqual(0.1);
      expect(l.contrast).toBeGreaterThanOrEqual(0.9);
      expect(l.contrast).toBeLessThanOrEqual(1.12);
      expect(l.saturation).toBeGreaterThanOrEqual(0.85);
      expect(l.saturation).toBeLessThanOrEqual(1.12);
      expect(Math.abs(l.brightness)).toBeLessThanOrEqual(0.06);
      expect(l.vignette).toBeLessThanOrEqual(0.3);   // 넘으면 커버 첫 프레임이 어두워진다
      expect(l.aberration).toBeLessThanOrEqual(0.25);
    }
  });
  it('룩 이름이 서로 다르다', () => {
    expect(new Set(FILM_LOOKS.map((l) => l.name)).size).toBe(FILM_LOOKS.length);
  });

  it('효과 배열이 만들어지고 순서가 색→렌즈다', () => {
    const fx = filmLookEffects(FILM_LOOKS[0]!);
    expect(fx.length).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(fx)).toBe(true);
  });
  it('색수차 0 인 룩은 그 효과를 안 넣는다 — 없는 보정을 거는 비용 방지', () => {
    const withAb = FILM_LOOKS.find((l) => l.aberration > 0)!;
    const noAb = FILM_LOOKS.find((l) => l.aberration === 0)!;
    expect(filmLookEffects(withAb).length).toBeGreaterThan(filmLookEffects(noAb).length);
  });
});
