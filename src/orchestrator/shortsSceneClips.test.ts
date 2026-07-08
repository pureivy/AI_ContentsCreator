import { describe, it, expect } from 'vitest';
import { buildMotionPrompt, extractVideoUrl, buildI2vBody } from './shortsSceneClips';

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
    expect(extractVideoUrl({ video: { url: 'httpx://a' } })).toBeNull();
  });
});
describe('buildI2vBody — 모델별 스키마 분기(순수)', () => {
  it('wan 계열: 세로 9:16 고정 + 145프레임@24fps(≈6초)', () => {
    const b = buildI2vBody('fal-ai/wan/v2.2-5b/image-to-video', 'p', 'data:x');
    expect(b).toEqual({ prompt: 'p', image_url: 'data:x', num_frames: 145, frames_per_second: 24, resolution: '720p', aspect_ratio: '9:16' });
  });
  it('ltx 계열: duration·1080p·무오디오', () => {
    const b = buildI2vBody('fal-ai/ltx-2/image-to-video/fast', 'p', 'data:x');
    expect(b).toEqual({ prompt: 'p', image_url: 'data:x', duration: 6, resolution: '1080p', fps: 25, generate_audio: false });
  });
});
