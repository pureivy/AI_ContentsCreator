import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { inheritShortsAssets, inheritedSceneImages, inheritedClips, INHERITED_FILES } from './shortsInherit';

const mk = (): { from: string; to: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inherit-'));
  const from = path.join(root, 'primary'); const to = path.join(root, 'sibling');
  fs.mkdirSync(path.join(from, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(from, 'clips'), { recursive: true });
  fs.writeFileSync(path.join(from, 'plan.json'), JSON.stringify({ title: 't', scenes: [{}, {}, {}] }));
  fs.writeFileSync(path.join(from, 'title-art.png'), 'png');
  fs.writeFileSync(path.join(from, 'thumbnail.jpg'), 'jpg');
  for (const n of ['blog-image-01.png', 'blog-image-02.png', 'blog-image-03.png']) fs.writeFileSync(path.join(from, 'scenes', n), 'x');
  fs.writeFileSync(path.join(from, 'clips', 'clip_02.mp4'), 'mp4');
  return { from, to };
};

describe('inheritShortsAssets', () => {
  it('대본·이미지·클립·캘리·썸네일을 복사한다', () => {
    const { from, to } = mk();
    const r = inheritShortsAssets(from, to);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(to, 'plan.json'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'title-art.png'))).toBe(true);
    expect(fs.readdirSync(path.join(to, 'scenes'))).toHaveLength(3);
    expect(fs.existsSync(path.join(to, 'clips', 'clip_02.mp4'))).toBe(true);
  });
  it('낭독은 승계하지 않는다 — 작가마다 목소리가 다르다', () => {
    const { from, to } = mk();
    fs.mkdirSync(path.join(from, 'remotion'), { recursive: true });
    fs.writeFileSync(path.join(from, 'remotion', 'narr_01.mp3'), 'mp3');
    inheritShortsAssets(from, to);
    expect(fs.existsSync(path.join(to, 'remotion'))).toBe(false);
    expect(INHERITED_FILES.some((f) => String(f).includes('narr'))).toBe(false);
  });
  it('썸네일 QA 미해결 표식도 함께 옮긴다 — 게이트를 물려받아야 한다', () => {
    const { from, to } = mk();
    fs.writeFileSync(path.join(from, 'thumb-qa-failed.json'), '{}');
    inheritShortsAssets(from, to);
    expect(fs.existsSync(path.join(to, 'thumb-qa-failed.json'))).toBe(true);
  });
  it('대본이 없으면 승계 실패 — 호출부가 일반 생성으로 돌아가야 한다', () => {
    const { from, to } = mk();
    fs.rmSync(path.join(from, 'plan.json'));
    expect(inheritShortsAssets(from, to).ok).toBe(false);
  });
  it('복사본이라 원편을 지워도 형제편이 산다', () => {
    const { from, to } = mk();
    inheritShortsAssets(from, to);
    fs.rmSync(from, { recursive: true, force: true });
    expect(fs.existsSync(path.join(to, 'plan.json'))).toBe(true);
    expect(fs.readdirSync(path.join(to, 'scenes'))).toHaveLength(3);
  });
});

describe('inheritedSceneImages / inheritedClips', () => {
  it('씬 순서대로 채우고 모자란 자리는 null', () => {
    const { from, to } = mk();
    inheritShortsAssets(from, to);
    const imgs = inheritedSceneImages(to, 5);
    expect(imgs).toHaveLength(5);
    expect(imgs.slice(0, 3).every(Boolean)).toBe(true);
    expect(imgs[3]).toBeNull();
  });
  it('클립은 clip_NN 규약대로 매칭된다', () => {
    const { from, to } = mk();
    inheritShortsAssets(from, to);
    const c = inheritedClips(to, 3);
    expect(c[0]).toBeNull();
    expect(c[1]).toContain('clip_02.mp4');
    expect(c[2]).toBeNull();
  });
  it('scenes 디렉터리가 없어도 안 터진다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    expect(inheritedSceneImages(root, 3)).toEqual([null, null, null]);
    expect(inheritedClips(root, 2)).toEqual([null, null]);
  });
});
