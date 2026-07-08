import { describe, it, expect } from 'vitest';
import { buildMotionPrompt, extractVideoUrl } from './shortsSceneClips';

describe('buildMotionPrompt — 원본 + 모션 접미(순수)', () => {
  it('원본 포함 + 시네마틱 모션·무텍스트 문구', () => {
    const p = buildMotionPrompt('a plant by the window');
    expect(p).toContain('a plant by the window');
    expect(p).toContain('cinematic motion');
    expect(p).toContain('no text');
  });
});
describe('extractVideoUrl — 정상/결측/이형 방어(순수)', () => {
  it('video.url 이 http 문자열일 때만 통과, 그 외 null', () => {
    expect(extractVideoUrl({ video: { url: 'https://x/y.mp4' } })).toBe('https://x/y.mp4');
    expect(extractVideoUrl({ video: {} })).toBeNull();
    expect(extractVideoUrl({})).toBeNull();
    expect(extractVideoUrl(null)).toBeNull();
    expect(extractVideoUrl({ video: { url: 42 } })).toBeNull();
    expect(extractVideoUrl({ video: { url: 'ftp://x' } })).toBeNull();
  });
});
