import { describe, it, expect } from 'vitest';
import { topicOf, planPlaylists, QuotaBudget, speciesPlaylistTitle, youtubeItemsFrom } from './youtubePlaylists';
import type { SpeciesGroup } from '../content/speciesRotation';

const CATALOG: SpeciesGroup[] = [{ group: '유실수', species: [
  { name: '감나무', aliases: ['단감', '감풍단감', '태추단감나무'] }, { name: '배롱나무' }, { name: '블루베리' },
] } as unknown as SpeciesGroup];
const noLoose = (): string | null => null;

// 2026-10-15 실제 제목으로 고정 — 낱말 하나 때문에 엉뚱한 재생목록에 가던 사례들.
describe('topicOf — 작업 재생목록 하나', () => {
  it('증상이 가지치기보다 먼저', () => {
    expect(topicOf('배롱나무 꽃 안 피는 이유, 전정·빛·거름·뿌리 네 가지로 좁히기', '배롱나무')).toBe('symptom');
  });
  it("'떨어진'은 증상이 아니다 — 겨울전정은 가지치기", () => {
    expect(topicOf('배롱나무 겨울전정, 잎이 떨어진 뒤에 하세요', '배롱나무')).toBe('prune');
  });
  it("물 간격은 관리 — '간격'만으로 심기에 가지 않는다", () => {
    expect(topicOf('블루베리 키우기, 가을엔 물 줄이는 게 아니라 간격을 벌려요', '블루베리')).toBe('care');
  });
  it("'이름보다'는 구별 이야기가 아니다", () => {
    expect(topicOf('어린이 정원 나무, 이름보다 이 두 선부터', null)).not.toBe('lore');
  });
  it('꽃 이름 구별은 구별 재생목록', () => {
    expect(topicOf('황매화 나무, 꽃 가운데만 보면 이름이 정해집니다', null)).toBe('lore');
  });
  it('나무 채널과 먼 편(수종·나무 낱말 없음)은 작업 재생목록에 넣지 않는다', () => {
    expect(topicOf('여름 다육이 살리는 법, 물보다 통풍입니다', null)).toBeNull();
    expect(topicOf('한여름 베란다 채소 다섯 가지, 지금 심어도 팔월 수확', null)).toBeNull();
  });
  it('묘목 고르기는 심기', () => {
    expect(topicOf('사과나무묘목 고르기, 확인할 네 곳', '사과나무')).toBe('plant');
  });
});

describe('planPlaylists — 수종은 5편부터', () => {
  const vids = (n: number, t: string) => Array.from({ length: n }, (_, i) => ({ videoId: `${t}${i}`, keyword: t, title: `${t} 가지치기 ${i}` }));
  it('5편 이상 수종만 수종 재생목록, 별칭(감풍단감)도 같은 수종', () => {
    const items = [...vids(4, '감나무'), { videoId: 'g5', keyword: '감풍단감', title: '감풍단감 낙과 원인' }, ...vids(2, '배롱나무')];
    const plan = planPlaylists(items, CATALOG, 5, noLoose);
    expect(plan.titles['species:감나무']).toBe(speciesPlaylistTitle('감나무'));
    expect(plan.titles['species:배롱나무']).toBeUndefined();
    expect(plan.members.find((m) => m.videoId === 'g5')?.keys).toEqual(['topic:symptom', 'species:감나무']);
    expect(plan.members.find((m) => m.videoId === '배롱나무0')?.keys).toEqual(['topic:prune']);
  });
  it('쓰이지 않는 작업 재생목록은 만들지 않는다', () => {
    const plan = planPlaylists(vids(1, '감나무'), CATALOG, 5, noLoose);
    expect(Object.keys(plan.titles)).toEqual(['topic:prune']);
  });
  it('어디에도 안 맞으면 배정 없음', () => {
    expect(planPlaylists([{ videoId: 'x', title: '여름꽃 여섯 가지' }], CATALOG, 5, noLoose).members).toEqual([]);
  });
});

describe('QuotaBudget·youtubeItemsFrom', () => {
  it('50단위씩, 모자라면 거절', () => {
    const b = new QuotaBudget(120);
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
    expect(b.remaining).toBe(20);
  });
  it('유튜브에 올라간 이 브랜드 편만(브랜드 없는 옛 편 포함)', () => {
    const items = youtubeItemsFrom([
      { brand: 'bionditree', youtubeId: 'a', title: 'A' }, { youtubeId: 'b', title: 'B' },
      { brand: 'other', youtubeId: 'c' }, { brand: 'bionditree', title: '미업로드' },
    ], 'bionditree');
    expect(items.map((i) => i.videoId)).toEqual(['a', 'b']);
  });
});
