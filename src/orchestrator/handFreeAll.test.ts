import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSceneImagePrompt } from './shorts';
import { dropHandTags, type CardLayout } from './cardLayout';
import { retireClip } from './shortsClipQa';

// 2026-11-10 감나무 FLUX.3 시험 — 장면 글은 손을 뺐는데 공통 지시·생활감 소품이 손을 불렀다.
describe('buildSceneImagePrompt — noHands', () => {
  const base = {
    style: '늦가을 마당', scene: '지주와 줄기를 8자로 묶은 결속부', index: 2, total: 5, seed: 'short_x',
    subject: '감나무', subjectLatin: 'Diospyros kaki', hero: '심은 지 2년 된 어린 감나무', heroChained: true,
  };
  it('손 문구·손 소품을 뺀다', () => {
    for (let k = 0; k < 12; k++) {
      const p = buildSceneImagePrompt({ ...base, seed: `short_${k}`, noHands: true });
      expect(p).not.toMatch(/손은 나무를 짚거나|손 동작|사람·손이 함께|손·손가락 왜곡|장갑과|손과 손톱|손끝을 따라/);
      expect(p).toContain('사람·손·손가락·팔이 화면 어디에도 없게');
    }
  });
  it('끄면 종전 그대로', () => {
    const p = buildSceneImagePrompt({ ...base });
    expect(p).toContain('손은 나무를 짚거나 가리키는 정도로만');
    expect(p).toContain('손·손가락 왜곡');
  });
});

describe('dropHandTags — 손 없는 그림의 손 표시 빼기', () => {
  const layout: CardLayout = {
    series: '감나무',
    slides: [
      { kind: 'photo', title: 'a', lead: 'b', photo: { use: 'file', path: '/x/blog-01.png' }, tags: ['줄기 잡는 손', '흙 닿는 자리', '껍질 손상 자리'] },
      { kind: 'photo', title: 'c', lead: 'd', photo: { use: 'file', path: '/x/frame-01.png' }, tags: ['사람 손 위치'] },
      { kind: 'photo', title: 'e', lead: 'f', photo: { use: 'file', path: '/x/gen.png' }, tags: ['장갑 낀 손'] },
    ],
  } as CardLayout;
  it('실촬영은 두고 그린 사진만', () => {
    const r = dropHandTags(layout, (ref) => ref?.use === 'file' && /frame-/.test(ref.path));
    expect(r.dropped).toBe(2);
    expect(r.layout.slides[0]!.tags).toEqual(['흙 닿는 자리', '껍질 손상 자리']);
    expect(r.layout.slides[1]!.tags).toEqual(['사람 손 위치']);
    expect(r.layout.slides[2]!.tags).toBeUndefined();
  });
});

describe('retireClip — 검수 탈락 클립을 폴더에서도 치운다', () => {
  it('clip_NN.mp4 → clip_NN.rejected.mp4, 실촬영·없는 파일은 그대로', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'clipqa-'));
    const f = path.join(d, 'clip_04.mp4'); fs.writeFileSync(f, 'x');
    const u = path.join(d, 'user_01.mp4'); fs.writeFileSync(u, 'x');
    retireClip(f); retireClip(u); retireClip(path.join(d, 'clip_09.mp4'));
    expect(fs.existsSync(f)).toBe(false);
    expect(fs.existsSync(path.join(d, 'clip_04.rejected.mp4'))).toBe(true);
    expect(fs.existsSync(u)).toBe(true);
    // 같은 이름이 이미 있으면 덮어쓰지 않는다
    fs.writeFileSync(f, 'y'); retireClip(f);
    expect(fs.readdirSync(d).filter((n) => n.startsWith('clip_04.rejected')).length).toBe(2);
  });
});
