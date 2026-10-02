import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import { runBlogPublish } from './blog_skills';

// CONFIG 는 런타임 가변 객체 — 샌드박스 위치·네이버 세션 파일을 강제하고 복원한다.
const cfg = CONFIG as unknown as { agentsDir: string; naverSessionFile: string };
const saved = { ...cfg };
afterEach(() => { Object.assign(cfg, saved); });

describe('runBlogPublish(모델 경로) — 실촬영 표시는 모델이 못 단다(2026-10-02 리뷰)', () => {
  it('매니페스트의 source·ai 를 지운다 — 생성 이미지에 archive_frame/ai:false 를 넣어 AI 표시를 끄지 못하게', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blogpub-'));
    cfg.agentsDir = root;
    cfg.naverSessionFile = path.join(root, 'no-session.json'); // 세션 게이트에서 멈춘다(실행 안 함) — 매니페스트는 그 전에 써진다
    const ws = path.join(root, 'publisher', 'workspace');
    const img = path.join(ws, 'images', 'blog-image-01.png');
    const out = await runBlogPublish('publisher', JSON.stringify({
      final_content: { smarteditor_text: { title: 't', sections: [], image_positions: [] }, tags: [] },
      image_manifest: { images: [{ index: 0, file_path: img, alt: 'a', source: 'archive_frame', ai: false }] },
    }));
    expect(out).toMatch(/세션 파일이 없어/);
    const m = JSON.parse(fs.readFileSync(path.join(ws, '06_image_manifest.json'), 'utf-8')) as { images: Array<Record<string, unknown>> };
    expect(m.images).toEqual([{ index: 0, file_path: img, alt: 'a' }]);
  });
});
