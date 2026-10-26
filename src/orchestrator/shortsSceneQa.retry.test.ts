import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 비전 판정·이미지 생성은 가짜 — 다시 그린 그림이 어느 폴더에 떨어지는지만 본다(2026-10-26).
const outDirs: string[] = [];
vi.mock('./agent', () => ({ microJSON: vi.fn(async () => ({ issues: [{ scene: 1, problem: '잡글자' }] })) }));
vi.mock('./visionCommon', async (orig) => ({ ...(await orig<typeof import('./visionCommon')>()), visionCapable: () => true, stdModel: () => 'm' }));
vi.mock('../tools/blog_skills', () => ({
  generateImagesForDraft: vi.fn(async (_draft: string, outDir: string, manifest: string) => {
    outDirs.push(outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const fp = path.join(outDir, 'blog-image-01.png');
    fs.writeFileSync(fp, outDir);
    fs.writeFileSync(manifest, JSON.stringify({ images: [{ file_path: fp }] }));
    return { ok: true, output: '' };
  }),
}));

describe('qaSceneImages — 다시 그리기 폴더는 검수마다 새로(2026-10-26)', () => {
  it('두 번 검수해도 앞 검수의 다시 그린 그림을 덮지 않는다 — scenes-retry/ 아래', async () => {
    const { qaSceneImages } = await import('./shortsSceneQa');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-qa-'));
    const src = path.join(d, 'a.png');
    const ok = path.join(d, 'b.png');
    fs.writeFileSync(src, 'a'); fs.writeFileSync(ok, 'b'); // 한 장만 불량(전량 불량은 다시 안 그린다)
    const r1 = await qaSceneImages({ dir: d, images: [src, ok], scenePrompts: ['p1', 'p2'], preset: 'photorealistic' });
    await new Promise((res) => setTimeout(res, 2));
    const r2 = await qaSceneImages({ dir: d, images: [src, ok], scenePrompts: ['p1', 'p2'], preset: 'photorealistic' });
    expect(outDirs).toHaveLength(2);
    expect(outDirs[0]).not.toBe(outDirs[1]);
    for (const o of outDirs) expect(path.relative(d, o).split(path.sep)[0]).toBe('scenes-retry');
    expect(r1.images[0]).not.toBe(r2.images[0]);
    expect(fs.readFileSync(r1.images[0]!, 'utf-8')).toBe(outDirs[0]); // 첫 검수 그림이 그대로 남는다
    fs.rmSync(d, { recursive: true, force: true });
  });
});
