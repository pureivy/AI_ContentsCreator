import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitRenderedSlides, readSourceFlagged } from './cardHtmlJob';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'card-html-'));

describe('commitRenderedSlides — 새 장이 나왔을 때만 옛 장과 바꾼다(2026-10-26)', () => {
  it('새 장이 있으면 옛 slide_NN 을 지우고 옮긴다 — 장 수가 줄면 남는 옛 장도 지운다', () => {
    const d = tmp();
    for (const n of ['01', '02', '03']) fs.writeFileSync(path.join(d, `slide_${n}.png`), `옛${n}`);
    const t = path.join(d, '.render-1');
    fs.mkdirSync(t);
    for (const n of ['01', '02']) fs.writeFileSync(path.join(t, `slide_${n}.png`), `새${n}`);
    expect(commitRenderedSlides(d, t)).toBe(2);
    expect(fs.readdirSync(d).sort()).toEqual(['slide_01.png', 'slide_02.png']);
    expect(fs.readFileSync(path.join(d, 'slide_01.png'), 'utf-8')).toBe('새01');
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('기대 장 수보다 적게 찍혔으면(부분 렌더) 옛 장을 건드리지 않고 0', () => {
    const d = tmp();
    for (const n of ['01', '02', '03']) fs.writeFileSync(path.join(d, `slide_${n}.png`), `옛${n}`);
    const t = path.join(d, '.render-3');
    fs.mkdirSync(t);
    fs.writeFileSync(path.join(t, 'slide_02.png'), '새02');
    expect(commitRenderedSlides(d, t, 3)).toBe(0);
    expect(fs.readFileSync(path.join(d, 'slide_02.png'), 'utf-8')).toBe('옛02');
    expect(fs.readdirSync(d).sort()).toEqual(['slide_01.png', 'slide_02.png', 'slide_03.png']);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('렌더가 아무것도 못 찍었으면(실패·시간 초과) 옛 장을 그대로 두고 0', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'slide_01.png'), '옛01');
    const t = path.join(d, '.render-2');
    fs.mkdirSync(t);
    expect(commitRenderedSlides(d, t)).toBe(0);
    expect(commitRenderedSlides(d, path.join(d, '없는-폴더'))).toBe(0);
    expect(fs.readdirSync(d)).toEqual(['slide_01.png']);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('readSourceFlagged — 수정 요청 칸 사실 대조가 생성 때 지적 목록을 다시 쓴다', () => {
  it('저장본을 읽고, 없거나 깨졌으면 빈 목록', () => {
    const d = tmp();
    expect(readSourceFlagged(d)).toEqual([]);
    fs.writeFileSync(path.join(d, 'source.flagged.json'), JSON.stringify(['감나무는 영하 30도에서도 산다', 3]));
    expect(readSourceFlagged(d)).toEqual(['감나무는 영하 30도에서도 산다']);
    fs.writeFileSync(path.join(d, 'source.flagged.json'), '{깨짐');
    expect(readSourceFlagged(d)).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
});
