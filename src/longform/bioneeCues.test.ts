import { describe, expect, it } from 'vitest';
import { CAPTION_TOP, FULL_W } from './sceneFull';
import {
  BIONEE_SCALE, STAGE_CAPTION_TOP, STAGE_W, autoBioneeCues, bioneePlace, bioneeTimeline, sceneBioneeCues, sceneToScreen, stripBioneeCues, validateCue, type AutoCueInput, type BioneeCue,
} from './bioneeCues';
import { lintScene, sceneTexts } from './sceneLint';
import { toFullProps } from './fullProps';
import { approxWords } from './sceneRules';
import type { Timeline } from './timeline';

const SCENE = (cues: string) => `import React from 'react';\nexport default function Scene() { return null; }\n${cues}\n`;

describe('sceneBioneeCues — 장면 파일 리터럴 읽기(eval 없이)', () => {
  it('작은따옴표·따옴표 없는 키·끝 쉼표·중첩 params·주석·음수', () => {
    const r = sceneBioneeCues(SCENE(`export const bioneeCues = [
      // 가리키기
      { at: 0.4, dur: 1.8, action: 'point', params: { target: { x: 1400, y: 420, }, }, },
      { at: 2.6, action: "turn", params: { to: -1 } },
      { at: 3, action: 'holdSign', params: { text: '잎이 진 뒤' } }, /* 끝 */
    ];`), { segSec: 6, narration: '잎이 다 진 뒤에 옮겨 심어야 뿌리가 덜 다칩니다.' });
    expect(r.found).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.cues).toEqual([
      { at: 0.4, dur: 1.8, action: 'point', params: { target: { x: 1400, y: 420 } } },
      { at: 2.6, action: 'turn', params: { to: -1 } },
      { at: 3, action: 'holdSign', params: { text: '잎이 진 뒤' } },
    ]);
  });
  it('타입 표기·as const 도 읽는다, 빈 배열 = 일부러 가만히', () => {
    expect(sceneBioneeCues(SCENE('export const bioneeCues: BioneeCue[] = [{ at: 1, action: \'nod\' }] as const;')).cues).toEqual([{ at: 1, action: 'nod' }]);
    const empty = sceneBioneeCues(SCENE('export const bioneeCues = [];'));
    expect(empty).toEqual({ found: true, cues: [], problems: [] });
    expect(sceneBioneeCues(SCENE('// 신호 없음')).found).toBe(false);
  });
  it('계산식·변수는 못 읽음(자동 신호로 — cues 없음)', () => {
    const a = sceneBioneeCues(SCENE('export const bioneeCues = [{ at: tNov / 30, action: \'nod\' }];'));
    expect(a.found).toBe(true);
    expect(a.cues).toBeUndefined();
    expect(a.problems[0]).toMatch(/읽을 수 없음/);
    expect(sceneBioneeCues(SCENE('export const bioneeCues = [{ at: 1 + 2, action: \'nod\' }];')).cues).toBeUndefined();
  });
  it('이상한 신호는 버리고 나머지는 쓴다 — 없는 동작·없는 표정·긴 팻말·문장 밖 팻말', () => {
    const r = sceneBioneeCues(SCENE(`export const bioneeCues = [
      { at: 0.2, action: 'dance' },
      { at: 0.5, action: 'face', params: { expr: 'crying' } },
      { at: 1, action: 'holdSign', params: { text: '아주 긴 팻말 글자' } },
      { at: 2, action: 'holdSign', params: { text: '물 주기' } },
      { at: 3, action: 'nod', params: { times: 9, color: 'red' } },
    ];`), { narration: '잎이 진 뒤에 심습니다.' });
    expect(r.cues!.map((c) => c.action)).toEqual(['face', 'nod']);
    expect(r.cues![0]!.params).toBeUndefined();
    expect(r.cues![1]!.params).toEqual({ times: 4 });
    expect(r.problems.join('\n')).toMatch(/없는 동작/);
    expect(r.problems.join('\n')).toMatch(/6자 이내/);
    expect(r.problems.join('\n')).toMatch(/문장에 없음/);
    expect(r.problems.join('\n')).toMatch(/모르는 params 'color'/);
  });
  it('세그먼트 안으로 at·dur 를 당기고, 한 문장 3개까지', () => {
    const r = sceneBioneeCues(SCENE(`export const bioneeCues = [
      { at: 9, action: 'nod' }, { at: 2.5, dur: 4, action: 'think' }, { at: 0, action: 'wave' }, { at: 1, action: 'hop' },
    ];`), { segSec: 3 });
    expect(r.cues).toHaveLength(3);
    expect(r.cues!.map((c) => c.action)).toEqual(['wave', 'hop', 'nod']);
    expect(r.cues![2]!.at).toBeLessThan(3);
    expect(r.problems.join('\n')).toMatch(/3개까지/);
    expect(validateCue({ at: 2.5, dur: 4, action: 'think' }, { segSec: 3 }).cue).toEqual({ at: 2.5, dur: 0.5, action: 'think' });
  });
});

describe('장면 검사와 함께', () => {
  const sentence = '잎이 다 진 뒤에 옮겨 심어야 뿌리가 덜 다칩니다.';
  it('팻말 글자는 장면 라벨로 세지 않는다', () => {
    const src = `const L1 = '뿌리';\n${SCENE("export const bioneeCues = [{ at: 1, action: 'holdSign', params: { text: '잎이 진 뒤' } }];")}`;
    expect(sceneTexts(src).map((t) => t.text)).toEqual(['뿌리']);
    expect(stripBioneeCues(src)).toContain('export const bioneeCues = [];');
  });
  it('신호 문제는 검사 문제로 알려 준다(에이전트가 고치게)', () => {
    const bad = lintScene(SCENE("export const bioneeCues = [{ at: 1, action: 'holdSign', params: { text: '물 주기' } }];"), 's001', sentence);
    expect(bad.some((p) => p.startsWith('비온이 신호:') && p.includes('문장에 없음'))).toBe(true);
    const ok = lintScene(SCENE("export const bioneeCues = [{ at: 1, action: 'point', params: { target: { x: 900, y: 400 } } }];"), 's001', sentence);
    expect(ok.some((p) => p.startsWith('비온이 신호'))).toBe(false);
  });
});

describe('autoBioneeCues — 장면이 신호를 안 줄 때', () => {
  const seg = (narration: string, over: Partial<AutoCueInput> = {}): AutoCueInput => ({ narration, words: approxWords(narration, 5), speechSec: 5, segSec: 5.5, ...over });
  it('첫 = 걸어 들어와 손 흔들기, 경고 = 놀람·걱정, 질문 = 생각, 강조 = 그 자리 가리키기, 요령 = 엄지, 끝 = 꾸벅 → 나감', () => {
    const c = autoBioneeCues([
      seg('오늘은 감나무 묘목 이야기입니다.'),
      seg('이때 물을 주면 안 됩니다.'),
      seg('뿌리가 썩어 죽습니다.'),
      seg('왜 그럴까요?'),
      seg('어린 나무는 뿌리가 얕습니다.', { accent: { word: '어린', x: 1300, y: 400 } }),
      seg('요령은 하나입니다.'),
      seg('그럼 다음에 뵙겠습니다.'),
    ]);
    expect(c.map((x) => x.map((y) => y.action))).toEqual([['walkIn', 'wave'], ['surprised'], ['worried'], ['think'], ['point'], ['thumbsUp'], ['bow', 'walkOut']]);
    expect(c[4]![0]!.params).toEqual({ target: { x: 1300, y: 400 } });
    for (const x of c.flat()) expect(x.at).toBeGreaterThanOrEqual(0);
  });
  it('바로 앞과 같은 동작은 다음 후보, 없으면 가만히', () => {
    const c = autoBioneeCues([seg('a'), seg('주의'), seg('주의하세요'), seg('주의, 꼭 확인하세요'), seg('b')]);
    expect(c.map((x) => x.map((y) => y.action))).toEqual([['walkIn', 'wave'], ['surprised'], [], ['surprised'], ['bow', 'walkOut']]);
  });
});

describe('bioneeTimeline — 편 전체 시간표', () => {
  it('무대 상수는 sceneFull 과 같다', () => {
    expect(STAGE_W).toBe(FULL_W);
    expect(STAGE_CAPTION_TOP).toBe(CAPTION_TOP);
  });
  it('장면 좌표 → 화면 좌표(LongFormFull 의 (W, CAPTION_TOP) 기준 축소와 같다)', () => {
    expect(sceneToScreen({ x: 1920, y: 886 }, 0.84)).toEqual({ x: 1920, y: 886 });
    expect(sceneToScreen({ x: 0, y: 0 }, 0.84)).toEqual({ x: 307, y: 142 });
    expect(sceneToScreen({ x: 1000, y: 500 }, 1)).toEqual({ x: 1000, y: 500 });
  });
  const segs = [
    { startFrame: 75, frames: 150, bionee: [{ at: 0, dur: 1.6, action: 'walkIn' }, { at: 1.7, action: 'wave' }] as BioneeCue[], mouth: [1, 2, 3] },
    { startFrame: 225, frames: 120, bionee: [{ at: 0.5, action: 'point', params: { target: { x: 1000, y: 500 } } }, { at: 2, action: 'peek' }, { at: 2.5, action: 'walkOut' }] as BioneeCue[], mouth: [5] },
    { startFrame: 420, frames: 90, bionee: [{ at: 0.2, action: 'walkTo', params: { x: 1500 } }] as BioneeCue[] },
  ];
  const chapters = [{ startFrame: 0, frames: 75 }, { startFrame: 345, frames: 75 }];
  const t = bioneeTimeline(segs, chapters, 510, { sceneScale: 0.84 });
  it('첫 등장은 첫 장 카드 동안, 가운데 walkOut·peek 은 버리고, 끝에 나가기를 채운다', () => {
    const acts = t.cues.map((c) => c.action);
    expect(t.cues[0]).toMatchObject({ action: 'walkIn', at: 0.3, params: { from: 'left' } });
    expect(acts).not.toContain('peek');
    expect(acts.filter((a) => a === 'walkOut')).toHaveLength(1);
    const out = t.cues.find((c) => c.action === 'walkOut')!;
    expect(out.at).toBeGreaterThanOrEqual(420 / 30);
    expect(out.at + out.dur!).toBeLessThanOrEqual(510 / 30); // 편 끝 전에 다 나간다(잘리지 않게)
  });
  it('세그먼트 초 → 편 초, 가리킬 곳은 화면 좌표, 걷기 x 는 비운 자리 안', () => {
    expect(t.cues.find((c) => c.action === 'wave')!.at).toBeCloseTo(75 / 30 + 1.7, 2);
    expect(t.cues.find((c) => c.action === 'point')).toMatchObject({ at: 8, params: { target: sceneToScreen({ x: 1000, y: 500 }, 0.84) } });
    const walk = t.cues.find((c) => c.action === 'walkTo')!;
    expect(walk.params!.x).toBe(bioneePlace(BIONEE_SCALE, 0.84).walk.max);
  });
  it('장 제목 카드 동안 제목을 바라보고 깡충(걸어 들어오는 첫 카드는 걷기 뒤)', () => {
    const look = t.cues.filter((c) => c.action === 'lookAt');
    expect(look.map((c) => c.at)).toEqual([expect.any(Number), 345 / 30 + 0.25].map((x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x)));
    expect(look[0]!.at).toBeGreaterThanOrEqual(0.3 + 1.6 - 0.01);
    // 첫 카드는 걸어 들어오느라 깡충할 틈이 없다(카드 2.5초 — 걷기 0.3~1.9초)
    expect(t.cues.filter((c) => c.action === 'hop').map((c) => c.at)).toEqual([Math.round((345 / 30 + 0.4) * 100) / 100]);
  });
  it('마지막 신호가 끝까지 차 있어도 나가기는 편 안에서 끝난다', () => {
    const t2 = bioneeTimeline([{ startFrame: 0, frames: 215, bionee: [{ at: 0, dur: 1.6, action: 'walkIn' }, { at: 6.0, dur: 1.6, action: 'worried' }] }], [], 215, { sceneScale: 0.84 });
    const out = t2.cues.find((c) => c.action === 'walkOut')!;
    expect(out.at + out.dur!).toBeLessThanOrEqual(215 / 30);
    const t3 = bioneeTimeline([{ startFrame: 0, frames: 150, bionee: [{ at: 4.5, action: 'walkOut' }] }], [], 150, { sceneScale: 0.84 });
    const o3 = t3.cues.find((c) => c.action === 'walkOut')!;
    expect(o3.at + o3.dur!).toBeLessThanOrEqual(5);
  });
  it('장면 축소 1(2026-10-23 본편 — 장면은 화면 전체, 비온이는 덮개 층)이면 가리킬 곳은 장면 좌표 그대로, 걷기는 x<420 안', () => {
    const t1 = bioneeTimeline([{ startFrame: 0, frames: 150, bionee: [{ at: 0.5, action: 'point', params: { target: { x: 1000, y: 500 } } }, { at: 3, action: 'walkTo', params: { x: 1500 } }] }], [], 150, { sceneScale: 1 });
    expect(t1.cues.find((c) => c.action === 'point')!.params!.target).toEqual({ x: 1000, y: 500 });
    expect(t1.cues.find((c) => c.action === 'walkTo')!.params!.x).toBeLessThan(420);
  });
  it('입 열림 — 편 길이 배열, 세그먼트 자리에만, 장 카드는 0', () => {
    expect(t.mouth).toHaveLength(510);
    expect(t.mouth.slice(74, 79)).toEqual([0, 1, 2, 3, 0]);
    expect(t.mouth[225]).toBe(5);
    expect(t.mouth.slice(345, 420).every((v) => v === 0)).toBe(true);
  });
  it('자리 — 발은 자막 띠 위, 크기 기본값', () => {
    expect(t.home.y).toBe(CAPTION_TOP - 12);
    expect(t.scale).toBe(BIONEE_SCALE);
    expect(t.home.x).toBeLessThan(sceneToScreen({ x: 0, y: 0 }, 0.84).x);
  });
});

describe('toFullProps — 진행자', () => {
  const tl: Timeline = {
    totalFrames: 200, chapterStarts: [{ id: 'c1', title: '장', startFrame: 0, frames: 50 }],
    segments: [{ id: 'a', chapter: 'c1', chapterTitle: '장', narration: '문장', audio: 'a.mp3', startFrame: 50, frames: 150, captions: [], shot: { kind: 'paper' } } as unknown as Timeline['segments'][number]],
  } as Timeline;
  it('꺼지면 비온이 필드가 없다(종전과 같다)', () => {
    const p = toFullProps('편', tl, { style: 'B' });
    expect(p.presenter).toBeUndefined();
    expect(p.segments[0]).not.toHaveProperty('bionee');
    expect(p.segments[0]).not.toHaveProperty('mouth');
  });
  it('켜면 세그먼트마다 신호·입, 편에 계절·장면 비율·크기', () => {
    const p = toFullProps('편', tl, { style: 'B', presenter: { season: 'autumn', sceneScale: 0.84, hostScale: 0.6, cues: new Map([['a', [{ at: 1, action: 'nod' }]]]), mouth: new Map([['a', [0, 3]]]) } });
    expect(p.presenter).toEqual({ season: 'autumn', sceneScale: 0.84, hostScale: 0.6 });
    expect(p.segments[0]!.bionee).toEqual([{ at: 1, action: 'nod' }]);
    expect(p.segments[0]!.mouth).toEqual([0, 3]);
  });
});
