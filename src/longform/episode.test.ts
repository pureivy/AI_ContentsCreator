import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { footageInventory, loadEpisodeScript, loadMediaVideos, migrateScript, PILOT_DIR_NAME, saveEpisodeScript, scriptText } from './episode';
import { PILOT_BANNED_WORDS, type LongformScript } from './script';
import { SOURCE_PIECES } from './source';

const S: LongformScript = { title: 't', chapters: [{ id: 'intro', title: '시작', segments: [{ id: 'intro-01', narration: '가' }] }] };

describe('migrateScript — 시범 대본만 금지어·원문 글 id 를 채운다', () => {
  it('시범 폴더', () => {
    const m = migrateScript(S, PILOT_DIR_NAME);
    expect(m.bannedWords).toEqual(PILOT_BANNED_WORDS);
    expect(m.sourcePieceIds).toEqual([...SOURCE_PIECES]);
  });
  it('다른 폴더는 그대로', () => {
    expect(migrateScript(S, '2026-10-26-plant')).toBe(S);
  });
});

describe('대본 읽기·쓰기', () => {
  it('저장한 대본을 그대로 읽고 평문을 만든다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-ep-'));
    saveEpisodeScript(dir, S);
    expect(loadEpisodeScript(dir)).toEqual(S);
    expect(scriptText(S)).toBe('t\n\n## 시작\n\n가\n');
  });
});

describe('footageInventory·loadMediaVideos', () => {
  it('수종별 쓸 수 있는 초(앞뒤 여백 뺌), 이미지·0초 제외', () => {
    expect(footageInventory([
      { id: 'a', file: 'a', kind: 'video', seconds: 11, species: '감나무' },
      { id: 'b', file: 'b', kind: 'video', seconds: 5, species: '감나무' },
      { id: 'c', file: 'c', kind: 'image', seconds: 0, species: '배나무' },
      { id: 'd', file: 'd', kind: 'video', seconds: 0.8, species: '배롱나무' },
    ])).toEqual({ 감나무: 14 });
  });
  it('있는 파일·영상·브랜드만', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-media-'));
    fs.mkdirSync(path.join(root, 'media'));
    const f = path.join(root, 'media', 'v.mp4');
    fs.writeFileSync(f, 'x');
    fs.writeFileSync(path.join(root, 'media', 'index.json'), JSON.stringify([
      { id: 'v', file: f, kind: 'video', seconds: 10, species: '감나무', brand: 'b1' },
      { id: 'gone', file: path.join(root, 'media', 'gone.mp4'), kind: 'video', seconds: 10, species: '감나무', brand: 'b1' },
      { id: 'other', file: f, kind: 'video', seconds: 10, species: '감나무', brand: 'b2' },
      { id: 'img', file: f, kind: 'image', species: '감나무', brand: 'b1' },
    ]));
    expect(loadMediaVideos(root, 'b1').map((m) => m.id)).toEqual(['v']);
    expect(loadMediaVideos(root).map((m) => m.id)).toEqual(['v', 'other']);
  });
});
