import { describe, it, expect } from 'vitest';
import { parseBlogFrameOutput } from './blog_skills';

describe('parseBlogFrameOutput — blog_frame.py 의 RESULT_JSON', () => {
  it('성공 줄 → 순간·해시·서명', () => {
    const r = parseBlogFrameOutput('로그\nRESULT_JSON: {"ok": true, "atSec": 8.3, "sharpness": 761.0, "brightness": 102.4, "hash": "24a5d5d97664c7c3", "sig": "AAAA", "file": "/x.png"}');
    expect(r).toEqual({ ok: true, atSec: 8.3, hash: '24a5d5d97664c7c3', sig: 'AAAA', sharpness: 761, brightness: 102.4 });
  });
  it('화질 거절은 reason(원장에 거절로 남긴다)', () => {
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "blurry", "detail": []}')).toEqual({ ok: false, reason: 'blurry' });
  });
  it('파일·도구 문제와 RESULT_JSON 없음은 error(원장에 남기지 않는다 — 그 순간의 화질 판정이 아니다)', () => {
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "extract_failed"}').error).toBe('extract_failed');
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "error:boom"}').error).toBe('error:boom');
    expect(parseBlogFrameOutput('(블로그 스킬 비활성 — BLOG_PYTHON 미설정)').error).toMatch(/비활성/);
    expect(parseBlogFrameOutput('RESULT_JSON: {깨짐').error).toMatch(/파싱/);
  });
  it('extract_failed 만 badMoment — 그 순간의 문제라 호출부가 기한부로 기록한다. 도구·파일 문제는 아니다', () => {
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "extract_failed"}')).toEqual({ ok: false, error: 'extract_failed', badMoment: true });
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "no_input"}').badMoment).toBeUndefined();
    expect(parseBlogFrameOutput('RESULT_JSON: {"ok": false, "reason": "error:boom"}').badMoment).toBeUndefined();
    expect(parseBlogFrameOutput('(블로그 스킬 비활성 — BLOG_PYTHON 미설정)').badMoment).toBeUndefined();
  });
});
