import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { kitForPresenter, mouthLevels, presenterCues, presenterSeason, sceneAccent, sceneCueOverride, targetOf, type CueInput } from './presenter';
import { approxWords } from './sceneRules';

const seg = (narration: string, over: Partial<CueInput> = {}): CueInput => ({ narration, words: approxWords(narration, 5), speechSec: 5, ...over });

describe('presenterSeason', () => {
  it('대본의 계절 낱말이 먼저', () => {
    expect(presenterSeason('감나무 묘목 가을 심기 전 점검', 1)).toBe('autumn');
    expect(presenterSeason('겨울 전정', 7)).toBe('winter');
  });
  it('없으면 렌더 달', () => {
    expect(presenterSeason('묘목 고르기', 4)).toBe('spring');
    expect(presenterSeason('묘목 고르기', 7)).toBe('summer');
    expect(presenterSeason('묘목 고르기', 10)).toBe('autumn');
    expect(presenterSeason('묘목 고르기', 12)).toBe('winter');
    expect(presenterSeason('묘목 고르기', 2)).toBe('winter');
    expect(presenterSeason('대추나무 심는 시기와 활착 확인, 10월 묘목부터', 10)).toBe('autumn'); // 제목만 — 요약의 '봄까지' 는 넘기지 않는다
  });
});

describe('sceneCueOverride', () => {
  it('장면이 내보낸 신호를 읽는다', () => {
    expect(sceneCueOverride(`export const presenterCue = { pose: 'clasp', at: 2.5 };`)).toEqual({ pose: 'clasp', at: 2.5 });
    expect(sceneCueOverride(`export const presenterCue: PresenterCue = { pose: "point", target: 'up', at: 1, until: 3 };`)).toEqual({ pose: 'point', at: 1, until: 3, target: 'up' });
  });
  it('모르는 자세·없음은 무시', () => {
    expect(sceneCueOverride(`export const presenterCue = { pose: 'dance' };`)).toBeUndefined();
    expect(sceneCueOverride('export default function Scene() {}')).toBeUndefined();
  });
});

describe('sceneAccent', () => {
  const src = `
  const tYoung = atFromWords(words, '어린', fps, 110);
  const tRoot = atFromWords(words, '뿌리가', fps, 30);
  <BLabel x={600} y={150} at={4} until={tYoung}>{L1}</BLabel>
  <BLabel x={1380} y={300} at={tYoung + 6} hi>{L2}</BLabel>`;
  it('처음 hi 라벨의 박자 낱말과 자리', () => {
    expect(sceneAccent(src)).toEqual({ word: '어린', x: 1380, y: 300 });
  });
  it('hi 라벨이 없으면 beat 박자', () => {
    expect(sceneAccent(`const tRoot = atFromWords(words, '뿌리가', fps, 30);\n hi={{ roots: beatInOut(f, tRoot, 90) }}`)).toEqual({ word: '뿌리가' });
  });
  it('가리킬 쪽 — 진행자 머리 위면 위, 아니면 오른쪽', () => {
    expect(targetOf({ x: 300 })).toBe('up');
    expect(targetOf({ x: 1380 })).toBe('right');
    expect(targetOf(undefined)).toBe('right');
  });
});

describe('presenterCues', () => {
  it('첫 = 손 흔들기, 끝 = 절, 경고 = 놀람, 강조 = 가리키기, 요령 = 두 손', () => {
    const cues = presenterCues([
      seg('오늘은 감나무 묘목 이야기입니다.'),
      seg('이때 물을 주면 안 됩니다.'),
      seg('어린 나무는 뿌리가 얕습니다.', { accent: { word: '어린', x: 1300 } }),
      seg('요령은 하나입니다.'),
      seg('그럼 다음에 뵙겠습니다.'),
    ]);
    expect(cues.map((c) => c.pose)).toEqual(['wave', 'surprised', 'point', 'clasp', 'bow']);
    expect(cues[2]).toMatchObject({ target: 'right' });
    expect(cues[1]!.at).toBeGreaterThan(0);
    expect(cues[1]!.until! - cues[1]!.at!).toBeLessThanOrEqual(2.2 + 1e-9);
  });
  it('장면 신호가 이긴다', () => {
    const cues = presenterCues([seg('a'), seg('주의하세요', { override: { pose: 'clasp', at: 1 } }), seg('b')]);
    expect(cues[1]).toEqual({ pose: 'clasp', at: 1 });
  });
  it('같은 몸짓이 이어지면 다음 후보, 없으면 가만히', () => {
    const cues = presenterCues([seg('a'), seg('주의'), seg('위험합니다'), seg('b'), seg('주의'), seg('위험합니다, 꼭 확인하세요'), seg('c')]);
    expect(cues.map((c) => c.pose)).toEqual(['wave', 'surprised', 'idle', 'idle', 'surprised', 'clasp', 'bow']);
  });
});

describe('mouthLevels', () => {
  it('조용하면 0, 소리가 크면 열리고, 두 프레임씩 같은 값', () => {
    const rate = 3000, fps = 30, frames = 12, per = rate / fps;
    const pcm = new Float32Array(rate * frames / fps);
    for (let f = 4; f < 8; f++) for (let k = 0; k < per; k++) pcm[f * per + k] = Math.sin(k) * 0.5;
    const m = mouthLevels(pcm, rate, fps, frames);
    expect(m).toHaveLength(frames);
    expect(m[0]).toBe(0);
    expect(m[4]).toBeGreaterThanOrEqual(6);
    for (let f = 1; f < frames; f += 2) expect(m[f]).toBe(m[f - 1]);
    expect(m[8]).toBeLessThan(m[6]!);
    expect(m[8]).toBeGreaterThan(0);
  });
});

describe('kitForPresenter', () => {
  const kit = fs.readFileSync('remotion/longform/fullscreen/KIT_API_B.md', 'utf8');
  const doc = fs.readFileSync('remotion/longform/fullscreen/KIT_API_BIONEE.md', 'utf8');
  it('꺼지면 키트 문서 그대로(진행자 말 없음)', () => {
    expect(kitForPresenter(kit)).toBe(kit);
    expect(kit).not.toMatch(/비온이|presenter/);
  });
  it('켜지면 진행자 문서가 뒤에 붙는다', () => {
    const on = kitForPresenter(kit, doc);
    expect(on.startsWith(kit.trimEnd())).toBe(true);
    expect(on).toContain('x < 420, y > 560');
    expect(on).toContain('export const bioneeCues');
    expect(on).toMatch(/리터럴만/);
  });
});
