import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corruptStoreFiles, isStoreFileCorrupt, readJsonArray, readJsonFile, resetStoreCorruptionForTest, writeJsonAtomic } from './jsonStore';
import { PieceStore } from '../content/pieces';
import { ShortsStore } from '../content/shorts';
import { loadCommentState, saveCommentState } from '../content/comments';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-'));
  resetStoreCorruptionForTest();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); resetStoreCorruptionForTest(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('readJsonFile / writeJsonAtomic', () => {
  it('없는 파일은 깨짐이 아니다(첫 기동) — 쓰기도 된다', () => {
    const f = path.join(dir, 'index.json');
    expect(readJsonArray(f, 't')).toEqual({ value: undefined, corrupt: false });
    writeJsonAtomic(f, [{ id: 'a' }], { backup: true });
    expect(JSON.parse(fs.readFileSync(f, 'utf-8'))).toEqual([{ id: 'a' }]);
    expect(fs.existsSync(`${f}.bak`)).toBe(false); // 바꿀 직전 판이 없었다
    expect(fs.existsSync(`${f}.tmp`)).toBe(false);
  });
  it('저장마다 직전 판을 .bak 으로 남긴다', () => {
    const f = path.join(dir, 'index.json');
    writeJsonAtomic(f, [1], { backup: true });
    writeJsonAtomic(f, [1, 2], { backup: true });
    expect(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf-8'))).toEqual([1]);
    expect(JSON.parse(fs.readFileSync(f, 'utf-8'))).toEqual([1, 2]);
  });
  it('깨질 때 마지막 정상본 .bak 을 .bak.pre-corrupt-<시각> 으로 따로 떠 둔다 — 재시작 뒤 저장이 .bak 을 덮어도 복구본이 남게', () => {
    const f = path.join(dir, 'index.json');
    writeJsonAtomic(f, [{ id: 'old' }], { backup: true });
    writeJsonAtomic(f, [{ id: 'old' }, { id: 'old2' }], { backup: true }); // .bak = [old]
    fs.writeFileSync(f, '[{"id":');                                         // 깨짐
    expect(readJsonArray(f, 't').corrupt).toBe(true);
    const keep = fs.readdirSync(dir).filter((n) => n.startsWith('index.json.bak.pre-corrupt-'));
    expect(keep).toHaveLength(1);
    // 재시작(기억 초기화) 뒤 빈 스토어로 두 번 저장해 .bak 이 덮여도 보존본은 그대로
    resetStoreCorruptionForTest();
    writeJsonAtomic(f, [{ id: 'new1' }], { backup: true });
    writeJsonAtomic(f, [{ id: 'new1' }, { id: 'new2' }], { backup: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, keep[0]!), 'utf-8'))).toEqual([{ id: 'old' }]);
  });
  it('읽기 오류(내용 손상 증거 아님)는 파일을 옮기지 않고 이번 실행 동안 쓰기만 막는다', () => {
    const f = path.join(dir, 'index.json');
    fs.mkdirSync(f); // readFileSync → EISDIR
    expect(readJsonArray(f, 't')).toEqual({ value: undefined, corrupt: true });
    expect(fs.statSync(f).isDirectory()).toBe(true);
    expect(fs.readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(false);
    expect(() => writeJsonAtomic(path.join(dir, 'index.json'), [1])).toThrow(/깨진 색인/);
  });
  it('임시 파일 이름에 pid 를 붙인다 — 재시작이 겹쳐도 서로의 임시 파일을 자르지 않게', () => {
    const f = path.join(dir, 'index.json');
    writeJsonAtomic(f, [1]);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('깨진 JSON — 지우지 않고 .corrupt-<시각> 으로 옮기고, 이후 쓰기는 거부(던지지 않고 읽기는 계속 빈 값)', () => {
    const f = path.join(dir, 'index.json');
    fs.writeFileSync(f, '[{"id":"a"},{"id":');
    const r = readJsonArray(f, 't');
    expect(r).toEqual({ value: undefined, corrupt: true });
    expect(fs.existsSync(f)).toBe(false);
    const q = fs.readdirSync(dir).filter((n) => n.startsWith('index.json.corrupt-'));
    expect(q).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, q[0]!), 'utf-8')).toBe('[{"id":"a"},{"id":');
    expect(isStoreFileCorrupt(f)).toBe(true);
    expect(corruptStoreFiles()[0]!.quarantined).toBe(path.join(dir, q[0]!));
    // 옮긴 뒤 다시 읽어도 ENOENT('빈 스토어')로 둔갑하지 않는다 — 함수형 스토어가 [새 항목] 하나로 덮는 사고 방지
    expect(readJsonArray(f, 't').corrupt).toBe(true);
    expect(() => writeJsonAtomic(f, [{ id: 'new' }])).toThrow(/깨진 색인/);
    expect(fs.existsSync(f)).toBe(false);
  });
  it('모양이 다르면(배열 자리에 객체) 깨짐', () => {
    const f = path.join(dir, 'index.json');
    fs.writeFileSync(f, '{"id":"a"}');
    expect(readJsonArray(f, 't').corrupt).toBe(true);
  });
  it('0바이트 파일도 깨짐(반쯤 쓴 파일)', () => {
    const f = path.join(dir, 'index.json');
    fs.writeFileSync(f, '');
    expect(readJsonFile(f, 't').corrupt).toBe(true);
  });
});

describe('스토어에 배선', () => {
  it('PieceStore — 깨진 색인이면 빈 채로 뜨고(서버는 뜬다) corrupt=true, 새 글은 디스크에 안 쓴다(증거 보존)', () => {
    fs.writeFileSync(path.join(dir, 'index.json'), '[{"id":"piece_1","title":"x"');
    const s = new PieceStore(dir);
    expect(s.corrupt).toBe(true);
    expect(s.list()).toEqual([]);
    s.create({ title: '새 글' }); // 메모리엔 들어가지만
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(false); // 원본 자리를 채우지 않는다
    expect(fs.readdirSync(dir).some((n) => n.startsWith('index.json.corrupt-'))).toBe(true);
  });
  it('ShortsStore — 정상 색인은 그대로 읽고 저장하며 corrupt=false', () => {
    const s = new ShortsStore(dir);
    expect(s.corrupt).toBe(false);
    const created = s.create({ topic: '모과 삽목' });
    const s2 = new ShortsStore(dir);
    expect(s2.get(created.id)?.id).toBe(created.id);
  });
  it('댓글 상태 — 깨지면 빈 상태를 주되 저장은 던진다(올리기 잠금이 fail-closed)', () => {
    const f = path.join(dir, 'comments.json');
    fs.writeFileSync(f, '{"items":[');
    const st = loadCommentState(f);
    expect(st.items).toEqual([]);
    expect(() => saveCommentState(st, f)).toThrow();
  });
});
