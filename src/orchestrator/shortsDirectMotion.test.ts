import { describe, it, expect } from 'vitest';
import { hasInfoCard, pickGraphicScenes, stripCards, sceneInfo, stageBox, sceneRanges, agentEnv, agentPrompt, type JobScene } from './shortsDirectMotion';
import type { ShortsScene } from '../tools/shortsCommon';

const compare: ShortsScene = { narration: '명자나무로 오해해요. 모과는 향이 퍼져요.', screenText: '향으로 구분해요', kind: 'compare', compare: { bad: { label: '명자나무로 오해', note: '작고 비슷해 보여서' }, good: { label: '모과나무는 향 퍼짐' } } };
const cta: ShortsScene = { narration: '세 가지면 돼요.', screenText: '향·가지·꽃', kind: 'cta', takeaways: [{ when: '가지가 휘었다면', then: '모과나무' }] };
const plain: ShortsScene = { narration: '봄까지 기다리면 돼요.', screenText: '4월 꽃' };
const hook: ShortsScene = { narration: '이 가지 보세요.', screenText: '휘어진 가지', kind: 'hook' };

describe('파일럿 그래픽 씬 고르기 — 정보 카드 씬만, 실촬영·훅·일반 씬은 원본 그대로', () => {
  it('카드 데이터가 있어야 정보 씬', () => {
    expect(hasInfoCard(compare)).toBe(true);
    expect(hasInfoCard(cta)).toBe(true);
    expect(hasInfoCard({ ...cta, takeaways: [] })).toBe(false);
    expect(hasInfoCard({ narration: 'x', kind: 'compare' })).toBe(false);
    expect(hasInfoCard(plain)).toBe(false);
  });
  it('훅·실촬영 씬은 카드가 있어도 제외', () => {
    expect(pickGraphicScenes([hook, plain, compare, plain, cta], [true, false, false, false, false])).toEqual([2, 4]);
    expect(pickGraphicScenes([hook, compare, cta], [true, true, false])).toEqual([2]);
  });
  it('카드 필드만 빼고 kind·라벨은 남긴다', () => {
    const s = stripCards(compare);
    expect(s.compare).toBeUndefined();
    expect(s.kind).toBe('compare');
    expect(s.screenText).toBe('향으로 구분해요');
    expect(compare.compare).toBeDefined(); // 원본 불변
  });
});

describe('sceneInfo — 대비(compare)까지 글자 그대로', () => {
  it('대비·상황→행동을 싣는다', () => {
    expect(sceneInfo(compare)).toBe('대비: ✕ 명자나무로 오해(작고 비슷해 보여서) / ✓ 모과나무는 향 퍼짐');
    expect(sceneInfo(cta)).toBe('상황→행동: 가지가 휘었다면 → 모과나무');
    expect(sceneInfo(plain)).toBe('');
  });
});

describe('stageBox — 제목 캘리 아래, 라벨 위', () => {
  it('제목 높이(26% 상한 contain)와 폭 기준 하단 여백으로 구역을 잡는다', () => {
    const b = stageBox({ titleTopPct: 5, titleWidthPct: 74, titleAspect: 667 / 1294, bottomPct: 50, fontPx: 70 });
    expect(b.top).toBeGreaterThan(500);
    expect(b.top).toBeLessThan(560);
    expect(b.top + b.height).toBeLessThan(1170); // 라벨(≈1163) 위
    expect(b.height).toBeGreaterThan(500);
  });
});

describe('sceneRanges — 원본과 같은 프레임 구간', () => {
  it('누적 시작 프레임과 그래픽 표시', () => {
    expect(sceneRanges([90, 184, 233], [2])).toEqual([
      { start: 0, frames: 90, graphic: false }, { start: 90, frames: 184, graphic: false }, { start: 274, frames: 233, graphic: true },
    ]);
  });
});

describe('agentEnv — 중첩 Claude Code 는 구독 로그인·바깥 세션 표식 없이', () => {
  it('API 키와 CLAUDE_CODE_* 를 뺀다', () => {
    const e = agentEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_CLI_PATH: 'claude' });
    expect(e).toEqual({ PATH: '/bin', CLAUDE_CLI_PATH: 'claude' });
  });
});

describe('agentPrompt — 우리 구역·농원 규칙', () => {
  it('구역 좌표·정보·수종 그림 금지가 들어간다', () => {
    const s: JobScene = { index: 2, frames: 233, duration: 7.77, fragment: 'scene_03.html', bgFrames: '/x', narration: compare.narration, label: '향으로 구분해요', source: '', info: sceneInfo(compare) };
    const p = agentPrompt('모과나무', { scenes: [s], stage: { top: 534, height: 607 } });
    expect(p).toContain('y=534~1141');
    expect(p).toContain('반드시 보여줄 정보: 대비: ✕ 명자나무로 오해');
    expect(p).toContain('수종 형태');
    expect(p).not.toContain('스타일 프레임 씬');
  });
});
