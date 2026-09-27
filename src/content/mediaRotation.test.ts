import { describe, it, expect } from 'vitest';
import { windowStarts, pickRotatedVideo, spareWindows, usableStart, readMediaHistory, type RotationUse } from './mediaRotation';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 씬 7초(35초 ÷ 5씬) + 여유 1.2초 = 간격 8.2초. 구간은 씬을 통째로(7초) 덮을 수 있을 때만 난다.
const SC = 7, TAIL = 1.2;

describe('windowStarts — 한 파일에서 쓸 수 있는 구간 시작점(순수)', () => {
  it('간격은 씬+여유, 남은 길이가 씬을 통째로 덮을 때만 다음 구간을 낸다', () => {
    expect(windowStarts(19, SC, TAIL)).toEqual([0, 8.2]);        // 8.2 → 남은 10.8 ✓ / 16.4 → 2.6 ✗
    expect(windowStarts(38.7, SC, TAIL)).toEqual([0, 8.2, 16.4, 24.6]); // 32.8 → 남은 5.9 ✗(감속이 걸린다)
  });
  it('꼬리가 씬을 못 덮으면 구간을 안 낸다 — 로테이션이 감속을 들여오면 안 된다', () => {
    expect(windowStarts(12.5, SC, TAIL)).toEqual([0]);  // 8.2 → 남은 4.3 ✗(하한 3.5 는 넘지만 7초를 못 덮는다)
  });
  it('짧은 파일은 구간이 하나 — 앞에서 뗀다(종전과 같다)', () => {
    expect(windowStarts(9.6, SC, TAIL)).toEqual([0]);
    expect(windowStarts(3, SC, TAIL)).toEqual([0]);    // 씬을 못 덮지만 배정은 배정이 판단한다(누락이 감속보다 나쁘다)
  });
  it('길이가 없으면 구간도 없다', () => {
    expect(windowStarts(0, SC, TAIL)).toEqual([]);
    expect(windowStarts(-1, SC, TAIL)).toEqual([]);
  });
});

describe('pickRotatedVideo — 안 쓴 파일·안 쓴 구간을 먼저(순수)', () => {
  const cand = (file: string, seconds: number, grade = 150) => ({ file, seconds, grade });
  const use = (file: string, startSec: number, at: number): RotationUse => ({ file, startSec, at });

  it('이력이 없으면 첫 후보의 첫 구간 — 종전과 같은 결과', () => {
    expect(pickRotatedVideo([cand('a', 19), cand('b', 19)], [], { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'a', startSec: 0 });
  });

  it('쓴 파일보다 안 쓴 파일이 먼저다 — 감나무 3개 중 1개만 6번 쓰던 것', () => {
    const hist = [use('a', 0, 100), use('a', 0, 200), use('a', 0, 300)];
    expect(pickRotatedVideo([cand('a', 19), cand('b', 19)], hist, { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'b', startSec: 0 });
  });

  it('둘 다 썼으면 더 오래전에 쓴 파일 — 그 파일 안에서는 안 쓴 구간으로', () => {
    const hist = [use('a', 0, 300), use('b', 0, 100)];
    expect(pickRotatedVideo([cand('a', 19), cand('b', 19)], hist, { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'b', startSec: 8.2 });
  });

  it('구간이 하나뿐인 오래된 파일은 그 구간을 다시 쓴다', () => {
    const hist = [use('a', 0, 300), use('b', 0, 100)];
    expect(pickRotatedVideo([cand('a', 19), cand('b', 9.6)], hist, { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'b', startSec: 0 });
  });

  it('파일이 하나면 안 쓴 구간으로 넘어간다 — 같은 앞 6초만 나가던 것', () => {
    expect(pickRotatedVideo([cand('a', 19)], [use('a', 0, 100)], { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'a', startSec: 8.2 });
  });

  it('구간을 다 돌면 가장 오래전 구간으로 되돌아온다', () => {
    const hist = [use('a', 0, 100), use('a', 8.2, 200)];
    expect(pickRotatedVideo([cand('a', 19)], hist, { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'a', startSec: 0 });
  });

  it('구간이 하나뿐인 짧은 파일은 계속 그 구간 — 누락보다 반복이 낫다', () => {
    expect(pickRotatedVideo([cand('a', 9.6)], [use('a', 0, 100)], { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: 'a', startSec: 0 });
  });

  it('등급을 넘어서 로테이션하지 않는다 — 범용 소재가 수종 일치를 이기면 안 된다', () => {
    const hist = [use('a', 0, 100), use('a', 8.2, 200)];
    const got = pickRotatedVideo([cand('a', 19, 150), cand('z', 19, 1)], hist, { sceneSec: SC, tailSec: TAIL });
    expect(got?.file).toBe('a'); // 다 쓴 a 를 재사용하더라도 점수 1 짜리로 내려가지 않는다
  });

  it('태그가 안 걸리면 같은 등급 전원이 후보다 — 실제 제목 61편 중 50편이 이 경우', () => {
    const got = pickRotatedVideo([cand('a', 19), cand('b', 9)], [use('a', 0, 100)], { sceneSec: SC, tailSec: TAIL });
    expect(got?.file).toBe('b');
  });

  it('태그 가점이 등급을 이기면 안 된다 — 등급 100+태그 6개(160)가 등급 150 을 이기면 다른 수종이 들어간다', () => {
    const got = pickRotatedVideo(
      [{ file: 'other-species', seconds: 19, grade: 100, bonus: 60 }, { file: 'primary', seconds: 19, grade: 150, bonus: 0 }],
      [], { sceneSec: SC, tailSec: TAIL });
    expect(got?.file).toBe('primary');
  });

  it('등급 안에서는 태그 적합이 다양성을 이긴다 — 묘목 편에 결실주 화면이 들어가면 안 된다', () => {
    // 태그가 걸린 쪽을 막 썼어도 그것을 쓴다(내용이 먼저다).
    const got = pickRotatedVideo(
      [{ file: 'sapling', seconds: 9, grade: 150, bonus: 10 }, { file: 'fruiting', seconds: 9, grade: 150, bonus: 0 }],
      [use('sapling', 0, 999)], { sceneSec: SC, tailSec: TAIL });
    expect(got?.file).toBe('sapling');
  });

  it('태그로 좁힌 뒤에도 둘 이상 남으면 그 안에서 로테이션한다 — 대추나무 실측(후보 3 → 2)', () => {
    const three = [
      { file: 'x', seconds: 19, grade: 150, bonus: 10 },
      { file: 'y', seconds: 19, grade: 150, bonus: 10 },
      { file: 'z', seconds: 19, grade: 150, bonus: 0 },
    ];
    expect(pickRotatedVideo(three, [use('x', 0, 100)], { sceneSec: SC, tailSec: TAIL })?.file).toBe('y');
    expect(pickRotatedVideo(three, [use('y', 0, 100)], { sceneSec: SC, tailSec: TAIL })?.file).toBe('x');
  });

  it('형제편 오프셋 — 파일이 둘이면 다른 파일, 하나면 다른 구간', () => {
    const two = [cand('a', 19), cand('b', 19)];
    expect(pickRotatedVideo(two, [], { sceneSec: SC, tailSec: TAIL, offset: 0 })).toEqual({ file: 'a', startSec: 0 });
    expect(pickRotatedVideo(two, [], { sceneSec: SC, tailSec: TAIL, offset: 1 })).toEqual({ file: 'b', startSec: 0 });
    const one = [cand('a', 19)];
    expect(pickRotatedVideo(one, [], { sceneSec: SC, tailSec: TAIL, offset: 1 })).toEqual({ file: 'a', startSec: 8.2 });
  });

  it('오프셋이 후보 수를 넘으면 돌아 나온다(빈 결과가 되면 실촬영이 통째로 사라진다)', () => {
    expect(pickRotatedVideo([cand('a', 9.6)], [], { sceneSec: SC, tailSec: TAIL, offset: 5 }))
      .toEqual({ file: 'a', startSec: 0 });
  });

  it('후보가 없으면 undefined', () => {
    expect(pickRotatedVideo([], [], { sceneSec: SC, tailSec: TAIL })).toBeUndefined();
    expect(pickRotatedVideo([cand('a', 0)], [], { sceneSec: SC, tailSec: TAIL })).toBeUndefined();
  });
});

describe('usableStart — 이 편에서 못 쓸 구간은 앞으로 되돌린다(순수)', () => {
  it('가장 짧은 씬의 하한을 넘기면 그 구간을 쓴다', () => {
    expect(usableStart(19, 8.2, [7, 9, 11])).toBe(8.2); // 남은 10.8초 ≥ 7×0.5
  });
  it('어느 씬도 못 채우면 0 — mustUse 강제 배치로 0.5배 밑 감속이 걸리는 자리', () => {
    expect(usableStart(12.5, 8.2, [9, 11, 14])).toBe(0); // 남은 4.3초 < 9×0.5
  });
  it('구간이 0 이거나 길이·씬이 없으면 0', () => {
    expect(usableStart(12.5, 0, [7])).toBe(0);
    expect(usableStart(0, 8.2, [7])).toBe(0);
    expect(usableStart(12.5, 8.2, [])).toBe(0);
  });
});

describe('spareWindows — 같은 파일의 다른 구간을 중간 컷 여분으로(순수)', () => {
  it('배정된 구간은 빼고, 먼 구간부터 — 컷이 크게 튀어야 컷으로 보인다', () => {
    expect(spareWindows('a', 38.7, 8.2, { sceneSec: SC, tailSec: TAIL })).toEqual([
      { file: 'a', startSec: 24.6, seconds: 14.1 },
      { file: 'a', startSec: 16.4, seconds: 22.3 },
      { file: 'a', startSec: 0, seconds: 38.7 },
    ]);
  });
  it('구간이 하나뿐이면 여분 없음 — 종전(컷 없음)으로 남는다', () => {
    expect(spareWindows('a', 9.6, 0, { sceneSec: SC, tailSec: TAIL })).toEqual([]);
  });
});

describe('readMediaHistory — 여분 행은 세지 않는다(2026-09-28 리뷰에서 잡은 결함)', () => {
  it('배정 행만 읽는다 — 여분을 세면 같은 mtime 동률로 구간 로테이션이 첫 편 뒤로 멈춘다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'histroot-'));
    const dir = path.join(root, 'short_x', 'clips');
    fs.mkdirSync(dir, { recursive: true });
    // 실제 모양: applyUserSegments 가 배정을 적고 normalizeSpareClips 가 여분을 같은 파일에 덧붙인다.
    fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([
      { scene: 2, file: '/m/a.mp4', startSec: 0, seconds: 7 },
      { scene: 2, file: '/m/a.mp4', startSec: 8.2, seconds: 10.8, role: 'spare' },
    ]), 'utf-8');
    const h = readMediaHistory(root);
    expect(h.map((x) => x.startSec)).toEqual([0]);

    // 그 이력으로 다음 편을 고르면 안 쓴 구간(8.2)으로 넘어가야 한다.
    expect(pickRotatedVideo([{ file: '/m/a.mp4', seconds: 19, grade: 150 }], h, { sceneSec: SC, tailSec: TAIL }))
      .toEqual({ file: '/m/a.mp4', startSec: 8.2 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('읽을 수 없으면 빈 목록 — 이력 실패로 생성이 멈추면 안 된다(fail-open)', () => {
    expect(readMediaHistory(path.join(os.tmpdir(), 'no-such-root-xyz'))).toEqual([]);
  });
});
