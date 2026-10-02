import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClipDescription, pickClipVideo, blogLogNoFromUrl, canPublishClip, CLIP_DESCRIPTION_MAX } from './naverClip';

// 클립엔 제목 칸이 없고 설명 300자가 전부다(2026-10-02 정찰) — 제목·본문·해시태그를 한 칸에 넣는다.
describe('buildClipDescription — 클립 설명 300자', () => {
  it('제목 / 본문 / 해시태그를 빈 줄로 잇는다', () => {
    expect(buildClipDescription('배롱나무 겨울전정', '잎이 떨어진 뒤에 하세요.', ['배롱나무', '#전정']))
      .toBe('배롱나무 겨울전정\n\n잎이 떨어진 뒤에 하세요.\n\n#배롱나무 #전정');
  });
  it('넘치면 본문만 자르고 제목·해시태그는 남긴다', () => {
    const out = buildClipDescription('제목', '가'.repeat(500), ['나무', '정원']);
    expect(out.length).toBeLessThanOrEqual(CLIP_DESCRIPTION_MAX);
    expect(out.startsWith('제목\n\n')).toBe(true);
    expect(out.endsWith('…\n\n#나무 #정원')).toBe(true);
  });
  it('태그는 공백을 빼고 중복을 지운다', () => {
    expect(buildClipDescription('t', '', ['대추 나무', '#대추나무', ' '])).toBe('t\n\n#대추나무');
  });
  it('제목과 태그만으로 넘치면 뒤쪽 태그부터 뺀다', () => {
    const tags = Array.from({ length: 80 }, (_, i) => `태그${i}`);
    const out = buildClipDescription('제목', '본문', tags);
    expect(out.length).toBeLessThanOrEqual(CLIP_DESCRIPTION_MAX);
    expect(out).toContain('#태그0');
    expect(out).not.toContain('#태그79');
  });
  it('유튜브 전용 태그(#shorts)는 뺀다', () => {
    expect(buildClipDescription('t', '', ['배롱나무', '#shorts', 'Shorts', '쇼츠'])).toBe('t\n\n#배롱나무');
  });
  it('본문이 비면 제목과 태그만', () => {
    expect(buildClipDescription('제목', '  ', [])).toBe('제목');
  });
});

describe('pickClipVideo — 원본만 올린다', () => {
  it('final.mp4 가 있으면 그것, 없으면 null(저화질 preview.mp4 로 대신하지 않는다)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
    fs.writeFileSync(path.join(dir, 'preview.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'download.mp4'), 'x');
    expect(pickClipVideo(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'final.mp4'), 'x');
    expect(pickClipVideo(dir)).toBe(path.join(dir, 'final.mp4'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('blogLogNoFromUrl', () => {
  it('두 주소 꼴에서 글 번호를 뽑는다', () => {
    expect(blogLogNoFromUrl('https://blog.naver.com/biondi_tree/224429014634')).toBe('224429014634');
    expect(blogLogNoFromUrl('http://m.blog.naver.com/PostView.naver?blogId=biondi_tree&logNo=224428543778&navType=tl')).toBe('224428543778');
  });
  it('글 주소가 아니면 null', () => {
    expect(blogLogNoFromUrl('https://blog.naver.com/biondi_tree/postwrite')).toBeNull();
    expect(blogLogNoFromUrl(undefined)).toBeNull();
  });
});

describe('canPublishClip — 유튜브용과 레거시만', () => {
  it('인스타용은 막는다', () => {
    expect(canPublishClip('youtube')).toBe(true);
    expect(canPublishClip(undefined)).toBe(true);
    expect(canPublishClip('instagram')).toBe(false);
  });
});
