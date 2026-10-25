import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LongformStore, isSafeLongformDir, longformRange, longformResendDue, longformRetryDue, LONGFORM_RANGE_CAP } from './longform';

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'longform-store-'));

describe('LongformStore — 파일 영속(원자적 교체)', () => {
  it('생성하면 index.json 에 남고 새 인스턴스가 다시 읽는다', () => {
    const root = tmpRoot();
    const s = new LongformStore(root);
    const r = s.create({ title: ' 과일나무 겨울 가지치기 ', brand: 'bionditree' });
    expect(r.id).toMatch(/^long_[0-9a-f]{10}$/);
    expect(r.dir).toBe(r.id); // 폴더 이름 미지정이면 id 와 같게
    expect(r.title).toBe('과일나무 겨울 가지치기');
    expect(r.stage).toBe('producing');
    expect(fs.existsSync(path.join(root, 'index.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'index.json.tmp'))).toBe(false);
    const again = new LongformStore(root);
    expect(again.get(r.id)?.title).toBe('과일나무 겨울 가지치기');
  });

  it('시범처럼 id·폴더를 고정할 수 있고, 같은 id 는 두 번 못 만든다', () => {
    const s = new LongformStore(tmpRoot());
    const r = s.create({ id: 'long_pilot20261019', dir: 'pilot-2026-10-19', title: 't', brand: 'b', stage: 'ready', patch: { thumbState: 'none' } });
    expect(r.dir).toBe('pilot-2026-10-19');
    expect(r.stage).toBe('ready');
    expect(r.thumbState).toBe('none');
    expect(() => s.create({ id: 'long_pilot20261019', title: 'x' })).toThrow();
  });

  it('update 는 id·createdTs·dir 을 지키고 updatedTs 를 갱신한다', () => {
    const s = new LongformStore(tmpRoot());
    const r = s.create({ id: 'long_a', dir: 'a', title: 't', brand: 'b' });
    const u = s.update(r.id, { youtubeState: 'uploading', progress: '업로드 10%', id: 'long_hack', dir: '../x', createdTs: 'x' } as never)!;
    expect(u.id).toBe('long_a');
    expect(u.dir).toBe('a');
    expect(u.createdTs).toBe(r.createdTs);
    expect(u.youtubeState).toBe('uploading');
    expect(s.update('long_none', {})).toBeUndefined();
  });

  it('list 는 최신순, remove 는 인덱스에서만 뺀다', () => {
    const root = tmpRoot();
    const s = new LongformStore(root);
    const a = s.create({ id: 'long_a', title: 'a', brand: 'b' });
    const b = s.create({ id: 'long_b', title: 'b', brand: 'b' });
    s.update(a.id, { createdTs: '2000-01-01T00:00:00Z' } as never); // createdTs 는 고정 — 순서는 생성 시각
    const ids = s.list().map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(s.remove(a.id)).toBe(true);
    expect(s.remove(a.id)).toBe(false);
    expect(new LongformStore(root).get(a.id)).toBeUndefined();
  });

  it('absDir 은 data/longform 밖으로 나가는 폴더를 거절한다', () => {
    const root = tmpRoot();
    const s = new LongformStore(root);
    expect(s.absDir({ dir: 'pilot-2026-10-19' })).toBe(path.join(root, 'pilot-2026-10-19'));
    expect(s.absDir({ dir: '../shorts' })).toBeNull();
    expect(s.absDir({ dir: '/etc' })).toBeNull();
    expect(() => s.create({ title: 't', dir: '../x' })).toThrow();
  });
});

describe('isSafeLongformDir(순수)', () => {
  it('폴더 이름 한 칸만 허용', () => {
    expect(isSafeLongformDir('pilot-2026-10-19')).toBe(true);
    expect(isSafeLongformDir('long_abc')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', '../a', '/abs', 'a\\b']) expect(isSafeLongformDir(bad)).toBe(false);
  });
});

describe('longformRange — 영상 Range 해석(순수)', () => {
  const size = 995_823_477;
  it('Range 없음·형식 밖·여러 범위는 null(전체 스트림)', () => {
    expect(longformRange(undefined, size)).toBeNull();
    expect(longformRange('bytes=-', size)).toBeNull();
    expect(longformRange('bytes=0-1,5-6', size)).toBeNull();
    expect(longformRange('items=0-1', size)).toBeNull();
  });
  it('열린 범위(bytes=0-)는 cap 만큼만', () => {
    expect(longformRange('bytes=0-', size)).toEqual({ start: 0, end: LONGFORM_RANGE_CAP - 1 });
    expect(longformRange('bytes=995823000-', size)).toEqual({ start: 995_823_000, end: size - 1 });
  });
  it('끝을 밝힌 범위는 그대로(파일 끝으로 자름), 뒤에서 K바이트', () => {
    expect(longformRange('bytes=100-199', size)).toEqual({ start: 100, end: 199 });
    expect(longformRange(`bytes=100-${size + 10}`, size)).toEqual({ start: 100, end: size - 1 });
    expect(longformRange('bytes=-500', size)).toEqual({ start: size - 500, end: size - 1 });
    expect(longformRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });
  it('만족 불가는 invalid(416)', () => {
    expect(longformRange(`bytes=${size}-`, size)).toBe('invalid');
    expect(longformRange('bytes=10-5', size)).toBe('invalid');
    expect(longformRange('bytes=-0', size)).toBe('invalid');
    expect(longformRange('bytes=0-', 0)).toBe('invalid');
  });
});

// 2026-10-25 — 재시작으로 끊긴 주간 편 자동 재시도·유실된 검토 알림 재발송 판정.
describe('longformRetryDue / longformResendDue', () => {
  const now = new Date(2026, 9, 25, 9, 0);
  const today = new Date(2026, 9, 25, 0, 1).toISOString();
  it('재시도 — 오늘 주간 자동 실행으로 시작한 제작 중 편, 한 번만', () => {
    expect(longformRetryDue({ stage: 'producing', trigger: 'weekly', createdTs: today }, now)).toBe(true);
    expect(longformRetryDue({ stage: 'producing', trigger: 'weekly', createdTs: today, autoRetried: true }, now)).toBe(false);
    expect(longformRetryDue({ stage: 'producing', createdTs: today }, now)).toBe(false); // 수동 실행
    expect(longformRetryDue({ stage: 'producing', trigger: 'weekly', createdTs: new Date(2026, 9, 24, 23, 0).toISOString() }, now)).toBe(false); // 어제
    expect(longformRetryDue({ stage: 'ready', trigger: 'weekly', createdTs: today }, now)).toBe(false);
  });
  it('재발송 — 완성·알림 없음·안 올림·7일 안만. 시범 편(유튜브 올림, notifiedTs 없음)은 제외', () => {
    expect(longformResendDue({ stage: 'ready', createdTs: today }, now)).toBe(true);
    // data/longform/index.json 의 시범 편 꼴
    expect(longformResendDue({ stage: 'ready', createdTs: '2026-10-22T08:03:02.259Z', youtubeId: 'e2Ujk0GuQyo', youtubeUrl: 'https://www.youtube.com/watch?v=e2Ujk0GuQyo', youtubeState: 'done' }, now)).toBe(false);
    expect(longformResendDue({ stage: 'ready', createdTs: today, notifiedTs: today }, now)).toBe(false);
    expect(longformResendDue({ stage: 'ready', createdTs: today, youtubeState: 'uploading' }, now)).toBe(false);
    expect(longformResendDue({ stage: 'ready', createdTs: new Date(2026, 9, 17, 9, 0).toISOString() }, now)).toBe(false); // 8일 전
    expect(longformResendDue({ stage: 'error', createdTs: today }, now)).toBe(false);
  });
});
