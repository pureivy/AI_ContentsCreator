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
    const r1 = await qaSceneImages({ dir: d, images: [src, ok], scenePrompts: ['p1', 'p2'], preset: 'photorealistic', perImage: false });
    await new Promise((res) => setTimeout(res, 2));
    const r2 = await qaSceneImages({ dir: d, images: [src, ok], scenePrompts: ['p1', 'p2'], preset: 'photorealistic', perImage: false });
    expect(outDirs).toHaveLength(2);
    expect(outDirs[0]).not.toBe(outDirs[1]);
    for (const o of outDirs) expect(path.relative(d, o).split(path.sep)[0]).toBe('scenes-retry');
    expect(r1.images[0]).not.toBe(r2.images[0]);
    expect(fs.readFileSync(r1.images[0]!, 'utf-8')).toBe(outDirs[0]); // 첫 검수 그림이 그대로 남는다
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('qaSceneImages — 한 장씩 판정(2026-11-09)', () => {
  it('장마다 따로 물어 순번을 전체 순번으로 되돌린다', async () => {
    const { qaSceneImages } = await import('./shortsSceneQa');
    const { microJSON } = await import('./agent');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-qa-'));
    const a = path.join(d, 'a.png'), b = path.join(d, 'b.png'), c = path.join(d, 'c.png');
    for (const f of [a, b, c]) fs.writeFileSync(f, 'x');
    const before = vi.mocked(microJSON).mock.calls.length;
    const r = await qaSceneImages({ dir: d, images: [a, null, b, c], scenePrompts: ['p1', '', 'p2', 'p3'], preset: 'photorealistic', checkOnly: true });
    expect(vi.mocked(microJSON).mock.calls.length - before).toBe(3);
    expect(r.bad).toEqual([0, 2, 3]);
    expect(r.issues).toEqual(['씬1: 잡글자', '씬2: 잡글자', '씬3: 잡글자']);
  });
});

describe('qaSceneImages — 수종 정답 사진(2026-11-09)', () => {
  it('정답 사진은 판정 대상 뒤에 붙고, 그 순번은 문제로 세지 않는다', async () => {
    const { qaSceneImages } = await import('./shortsSceneQa');
    const { microJSON } = await import('./agent');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-qa-'));
    const a = path.join(d, 'a.png'), t = path.join(d, 'truth.jpg');
    fs.writeFileSync(a, 'x'); fs.writeFileSync(t, 'x');
    vi.mocked(microJSON).mockResolvedValueOnce({ issues: [{ scene: 1, problem: '홑잎' }, { scene: 2, problem: '정답 사진을 문제로 오인' }] });
    const r = await qaSceneImages({ dir: d, images: [a], scenePrompts: ['p'], preset: 'photorealistic', checkOnly: true, subjectLatin: 'Akebia quinata', refPhotos: [t] });
    const call = vi.mocked(microJSON).mock.calls.at(-1)!;
    expect((call[3] as { visionPaths: string[] }).visionPaths).toEqual([a, t]);
    expect(String(call[2])).toContain('마지막 1장(2~2번째)은 판정 대상이 아니라');
    expect(r.issues).toEqual(['씬1: 홑잎']);
  });
});
