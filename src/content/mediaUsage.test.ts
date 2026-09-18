import { describe, it, expect } from 'vitest';
import { buildMediaUsage, blogStatusOf, type UsageDeps, type MediaLike, type PieceLike, type ShortsLike } from './mediaUsage';

const ALIAS: Record<string, string> = { 백일홍: '배롱나무', 음나무: '엄나무' };
const canon = (n: string): string => ALIAS[n] ?? n;
const speciesOf = (t: string): string | undefined => {
  for (const sp of ['배롱나무', '감나무', '엄나무', '자두나무']) if (t.includes(sp) || Object.entries(ALIAS).some(([a, c]) => c === sp && t.includes(a))) return sp;
  return undefined;
};
const media: MediaLike[] = [
  { id: 'm1', file: '/lib/gam1.mp4', kind: 'video', species: '감나무', tags: ['결실주'], createdTs: '2026-09-05T00:00:00Z', seconds: 30 },
  { id: 'm2', file: '/lib/gam2.jpg', kind: 'image', species: '감나무', tags: ['결실주'], createdTs: '2026-09-08T00:00:00Z' },
  { id: 'm3', file: '/lib/baek.mp4', kind: 'video', species: '백일홍', tags: ['꽃'], createdTs: '2026-09-05T00:00:00Z', seconds: 11 },
  { id: 'm4', file: '/lib/eum.mp4', kind: 'video', species: '음나무', tags: ['묘목'], createdTs: '2026-09-04T00:00:00Z', seconds: 20 },
  { id: 'm5', file: '/lib/jadu.mp4', kind: 'video', species: '자두나무', createdTs: '2026-09-08T00:00:00Z', seconds: 12 },
  { id: 'm6', file: '/lib/generic.jpg', kind: 'image', createdTs: '2026-09-08T00:00:00Z' }, // 무표기 — 표에 안 오름
];
const pieces: PieceLike[] = [
  { id: 'p1', title: '감나무 가을 거름', stage: 'reflected', publishedUrl: 'https://n/1', publishedTs: '2026-08-26T00:00:00Z', createdTs: '2026-08-25T00:00:00Z' },
  { id: 'p2', title: '감나무 묘목 고르기', stage: 'published', publishedUrl: 'https://n/2', publishedTs: '2026-09-01T00:00:00Z', createdTs: '2026-08-31T00:00:00Z' },
  { id: 'p3', title: '배롱나무 9월', stage: 'ready', privateUrl: 'https://n/p3', createdTs: '2026-09-07T00:00:00Z' },
  { id: 'p4', title: '엄나무 묘목', stage: 'ready', createdTs: '2026-09-05T00:00:00Z' },
];
const shorts: ShortsLike[] = [
  { id: 's1', topic: '엄나무 묘목은 굵기 전에', platform: 'youtube', stage: 'ready', youtubeId: 'Y1', youtubeUrl: 'https://youtube.com/shorts/Y1', youtubeTs: '2026-09-04T23:00:00Z', createdTs: '2026-09-04T22:00:00Z' },   // 기록 있음(정확)
  { id: 's2', topic: '배롱나무 꽃 안 피는 이유', platform: 'instagram', stage: 'ready', igReelId: 'I1', igPermalink: 'https://www.instagram.com/reel/AAA/', metaPublishedTs: '2026-09-05T11:00:00Z', createdTs: '2026-09-05T10:00:00Z' }, // 기록 없음·user 클립 있음(추정)
  { id: 's3', topic: '감나무 잎 색', platform: 'youtube', stage: 'ready', youtubeId: 'Y3', createdTs: '2026-09-06T00:00:00Z' },             // 실촬영 없음 — 링크는 잡힌다
  { id: 's4', topic: '감나무 거름', platform: 'youtube', stage: 'ready', youtubeId: 'Y4', youtubeTs: '2026-09-02T00:00:00Z', createdTs: '2026-09-01T00:00:00Z' }, // 더 오래된 감나무 유튜브
];
const deps: UsageDeps = {
  sourcesOf: (id) => (id === 's1' ? [{ scene: 2, file: '/lib/eum.mp4', startSec: 0, seconds: 6 }, { scene: 4, file: '/lib/eum.mp4', startSec: 6, seconds: 5 }] : null),
  hasUserClip: (id) => id === 's1' || id === 's2',
  speciesOf, canon,
};

describe('buildMediaUsage — 보관소 × 블로그 × 쇼츠 사용 현황(순수)', () => {
  const u = buildMediaUsage({ media, pieces, shorts }, deps);
  const row = (sp: string) => u.species.find((r) => r.species === sp)!;

  it('딱지가 별칭이어도 표준명 한 줄로 묶고 딱지를 따로 보여 준다', () => {
    expect(u.species.map((r) => r.species).sort()).toEqual(['감나무', '배롱나무', '엄나무', '자두나무']);
    expect(row('배롱나무').labels).toEqual(['백일홍']);
    expect(row('엄나무').labels).toEqual(['음나무']);
    expect(row('감나무').images).toBe(1); expect(row('감나무').videos).toBe(1);
  });
  it('무표기 소재는 수종 표에 오르지 않는다', () => {
    expect(u.species.some((r) => r.species === '')).toBe(false);
    expect(u.summary.species).toBe(4);
  });
  it('블로그 발행과 영상 사용은 별개 — 감나무는 글 2편인데 영상은 미사용', () => {
    expect(row('감나무').blog).toMatchObject({ status: 'public', count: 2, latest: { id: 'p2', url: 'https://n/2' } });
    expect(row('감나무').unused).toBe(true);
    expect(row('감나무').shorts).toEqual([]);
  });
  it('정확 기록(sources.json)은 파일과 씬까지 붙는다', () => {
    const e = row('엄나무');
    expect(e.unused).toBe(false);
    expect(e.shorts).toHaveLength(1);
    expect(e.shorts[0]).toMatchObject({ shortId: 's1', exact: true, scenes: [2, 4], youtubeId: 'Y1', platform: 'youtube' });
    expect(u.files['m4']).toHaveLength(2);
    expect(u.files['m4']!.map((f) => f.scene)).toEqual([2, 4]);
    expect(e.lastUsedTs).toBe('2026-09-04T22:00:00Z');
  });
  it('기록 없는 옛 편은 제목 수종으로 추정 — 파일 표에는 안 오르고 추정 표시가 붙는다', () => {
    const b = row('배롱나무');
    expect(b.shorts).toHaveLength(1);
    expect(b.shorts[0]).toMatchObject({ shortId: 's2', exact: false, scenes: [], igReelId: 'I1' });
    expect(u.files['m3']).toBeUndefined();
    expect(u.summary.estimatedShorts).toBe(1);
  });
  it('실촬영이 없는 편은 사용으로 세지 않는다', () => {
    expect(u.species.flatMap((r) => r.shorts).some((s) => s.shortId === 's3')).toBe(false);
  });
  it('블로그 상태 우선순위 — 비공개 발행 > 검토 대기 > 없음', () => {
    expect(row('배롱나무').blog.status).toBe('private');
    expect(row('엄나무').blog.status).toBe('ready');
    expect(row('자두나무').blog.status).toBe('none');
    expect(u.summary.blogNone).toBe(1);
  });
  it('정렬 — 미사용이 먼저, 그 안에서 영상 많은 순', () => {
    const order = u.species.map((r) => r.species);
    expect(order.indexOf('감나무')).toBeLessThan(order.indexOf('엄나무'));
    expect(order.indexOf('자두나무')).toBeLessThan(order.indexOf('배롱나무'));
    expect(u.summary.unused).toBe(2);
  });
  it('링크 열 — 실촬영 사용과 무관하게 그 수종의 최신 블로그·유튜브·인스타 주소를 준다', () => {
    const g = row('감나무');
    expect(g.links.blog).toMatchObject({ url: 'https://n/2', title: '감나무 묘목 고르기' });
    expect(g.links.youtube).toMatchObject({ url: 'https://youtube.com/shorts/Y3' }); // id 만 있어도 주소를 만든다 · 최신 우선
    expect(g.links.instagram).toBeUndefined();
    expect(row('배롱나무').links.instagram).toMatchObject({ url: 'https://www.instagram.com/reel/AAA/' });
    expect(row('배롱나무').links.blog).toMatchObject({ url: 'https://n/p3' }); // 비공개 발행 주소도 링크
    expect(row('엄나무').links.youtube).toMatchObject({ url: 'https://youtube.com/shorts/Y1' });
    expect(row('자두나무').links).toEqual({});
  });
  it('deps 가 던져도 표는 나온다(fail-open)', () => {
    const bad: UsageDeps = { sourcesOf: () => { throw new Error('x'); }, hasUserClip: () => { throw new Error('x'); }, speciesOf: () => { throw new Error('x'); }, canon: () => { throw new Error('x'); } };
    const r = buildMediaUsage({ media, pieces, shorts }, bad);
    expect(r.species.length).toBe(4);
    expect(r.species.every((x) => x.unused && x.blog.status === 'none')).toBe(true);
  });
});

describe('blogStatusOf — 발행 상태(순수)', () => {
  it('공개가 하나라도 있으면 public 이고 편수는 공개 편수, 최근은 발행일 기준', () => {
    const s = blogStatusOf([
      { id: 'a', title: 'A', stage: 'published', publishedUrl: 'u', publishedTs: '2026-08-01T00:00:00Z', createdTs: '2026-07-01T00:00:00Z' },
      { id: 'b', title: 'B', stage: 'reflected', publishedUrl: 'u', publishedTs: '2026-09-01T00:00:00Z', createdTs: '2026-06-01T00:00:00Z' },
      { id: 'c', title: 'C', stage: 'ready', privateUrl: 'p', createdTs: '2026-09-07T00:00:00Z' },
    ]);
    expect(s).toMatchObject({ status: 'public', count: 2, latest: { id: 'b' } });
  });
  it('글이 없으면 none', () => { expect(blogStatusOf([])).toEqual({ status: 'none', count: 0 }); });
});

describe('buildMediaUsage — 여분 클립 줄(role: spare, fix round 2)도 파일·씬 단위로 센다', () => {
  // 씬 2 는 배정 클립(m4), 같은 씬 뒷 절반에 여분(m5)이 들어갔다 — sources.json 에 같은 모양의 줄이 하나 더 붙는다.
  const shorts2: ShortsLike[] = [
    { id: 's9', topic: '엄나무 묘목 심기', platform: 'youtube', stage: 'ready', youtubeId: 'Y9', createdTs: '2026-09-18T00:00:00Z' },
  ];
  const deps2: UsageDeps = {
    sourcesOf: (id) => (id === 's9' ? [
      { scene: 2, file: '/lib/eum.mp4', startSec: 0, seconds: 7 },
      { scene: 2, file: '/lib/jadu.mp4', startSec: 0, seconds: 4.7, role: 'spare' },
    ] : null),
    hasUserClip: () => true, speciesOf, canon,
  };
  const u = buildMediaUsage({ media, pieces: [], shorts: shorts2 }, deps2);
  it('여분 파일(m5)이 파일 표에 그 씬으로 오르고, 그 수종 줄은 정확(exact) 사용으로 잡힌다', () => {
    expect(u.files['m4']!.map((f) => f.scene)).toEqual([2]);
    expect(u.files['m5']!.map((f) => f.scene)).toEqual([2]);
    const jadu = u.species.find((r) => r.species === '자두나무')!;
    expect(jadu.unused).toBe(false);
    expect(jadu.shorts[0]).toMatchObject({ shortId: 's9', exact: true, scenes: [2] });
    expect(u.summary.estimatedShorts).toBe(0); // 기록이 있으니 추정이 아니다
  });
});
