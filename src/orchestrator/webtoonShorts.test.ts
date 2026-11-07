import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { bumpRedraw, pinI2vEngine, pinT2iModel, shotlistScenes, webtoonShortsMeta } from './webtoonShorts';
import { isProgressLine, parseSmResult } from '../tools/shortMarker';
import { WebtoonStore, markInterruptedWebtoon } from '../content/webtoon';

const SL = {
  id: 'p1', hook: '거실로 들일 뻔한 블루베리',
  scenes: [
    { id: 's01', narration: '첫 한파 예보에, 블루베리 화분부터 걱정됐어요.', motion: 'i2v' },
    { id: 's02', narration: '따뜻한 거실로 들이려고 화분을 번쩍 들었죠.' },
    { id: 's03', narration: '꽃눈이 추위를 못 겪으면 이듬해 꽃이 줄어든대요.', redraw: 1 },
  ],
};

describe('parseSmResult — SHORT_marker 마지막 줄 JSON 계약', () => {
  it('Remotion 잡음 뒤 마지막 결과 줄을 읽는다', () => {
    const out = ['[15:31:00] Remotion render -> x.mp4', 'Encoded 1448/1448', '{"ok": true, "code": 0, "stage": "render", "mp4": "/a/b.mp4", "duration_sec": 37.2}', ''].join('\n');
    const r = parseSmResult(out)!;
    expect(r.ok).toBe(true);
    expect(r.mp4).toBe('/a/b.mp4');
    expect(r.duration_sec).toBe(37.2);
  });
  it('code 없는 JSON 이나 결과 줄이 없으면 null', () => {
    expect(parseSmResult('{"foo": 1}\nhello')).toBeNull();
    expect(parseSmResult('Traceback ...\nValueError')).toBeNull();
  });
  it('실패 결과(잠금)도 그대로', () => {
    const r = parseSmResult('{"ok": false, "code": 5, "stage": "lock", "error": "another produce run holds the lock"}')!;
    expect(r.ok).toBe(false);
    expect(r.code).toBe(5);
  });
});

describe('isProgressLine — 제작실에 보일 진행 줄', () => {
  it('시각 붙은 단계 줄·라운드 줄만', () => {
    expect(isProgressLine('[07:44:21] Qwen edit: 8 jobs, 0 to generate')).toBe(true);
    expect(isProgressLine('round 1: 52s, 0 errors')).toBe(true);
    expect(isProgressLine('Encoded 1105/1448')).toBe(false);
    expect(isProgressLine('[Tab 2, @remotion/media] Use the `objectFit` prop')).toBe(false);
    expect(isProgressLine('{"ok": true, "code": 0}')).toBe(false);
  });
});

describe('shotlistScenes·bumpRedraw', () => {
  it('장면 요약은 id·낭독·motion', () => {
    expect(shotlistScenes(SL)).toEqual([
      { id: 's01', narration: SL.scenes[0]!.narration, motion: 'i2v' },
      { id: 's02', narration: SL.scenes[1]!.narration },
      { id: 's03', narration: SL.scenes[2]!.narration },
    ]);
  });
  it('고른 장면만 redraw +1, 모르는 id 는 무시, 원본은 그대로', () => {
    const { shotlist, bumped } = bumpRedraw(SL, ['s02', 's03', 's99']);
    expect(bumped).toEqual(['s02', 's03']);
    expect(shotlist.scenes.map((s) => s.redraw ?? 0)).toEqual([0, 1, 2]);
    expect(SL.scenes[1]).not.toHaveProperty('redraw');
  });
});

describe('webtoonShortsMeta — 숏폼 기록 글', () => {
  it('제목은 훅, 설명은 낭독 앞 세 문장, 해시태그는 키워드', () => {
    const m = webtoonShortsMeta({ topic: '블루베리 겨울', keyword: '블루베리 월동', hook: SL.hook }, shotlistScenes(SL));
    expect(m.title).toBe(SL.hook);
    expect(m.description).toContain('번쩍 들었죠');
    expect(m.hashtags[0]).toBe('#블루베리월동');
  });
  it('훅이 없으면 주제를 제목으로', () => {
    expect(webtoonShortsMeta({ topic: '감나무 전정' }, []).title).toBe('감나무 전정');
  });
});

describe('markInterruptedWebtoon — 재시작 때 돌던 단계는 중단됨', () => {
  it('writing·drawing·producing 만 error 로, review·ready 는 그대로', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtoon-'));
    const st = new WebtoonStore(dir);
    const a = st.create({ pieceId: 'piece_a', topic: 'a' });
    const b = st.create({ pieceId: 'piece_b', topic: 'b' }); st.update(b.id, { stage: 'review' });
    const c = st.create({ pieceId: 'piece_c', topic: 'c' }); st.update(c.id, { stage: 'producing' });
    const out = markInterruptedWebtoon(st);
    expect(out.sort()).toEqual([a.id, c.id].sort());
    expect(st.get(c.id)!.error).toContain('(producing)');
    expect(st.get(c.id)!.failedStage).toBe('producing');
    expect(st.get(b.id)!.stage).toBe('review');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('pinI2vEngine', () => {
  it('없으면 적고, 이미 적힌 엔진은 그대로 둔다', () => {
    const base = { id: 'x', scenes: [] };
    const a = pinI2vEngine(base, 'minimax_pika');
    expect(a.changed).toBe(true);
    expect(a.shotlist.i2v_engine).toBe('minimax_pika');
    expect(base).not.toHaveProperty('i2v_engine');
    const b = pinI2vEngine({ ...base, i2v_engine: 'ltx' }, 'minimax_pika');
    expect(b.changed).toBe(false);
    expect(b.shotlist.i2v_engine).toBe('ltx');
  });
});

describe('pinT2iModel', () => {
  it('없으면 t2i_model 을 적고, t2i_model 이나 character.model 이 있으면 그대로', () => {
    const a = pinT2iModel({ id: 'x', scenes: [], character: { prompt: 'p' } }, 'qwen21');
    expect(a.changed).toBe(true);
    expect(a.shotlist.t2i_model).toBe('qwen21');
    expect(pinT2iModel({ id: 'x', scenes: [], t2i_model: 'flux2klein' }, 'qwen21').changed).toBe(false);
    expect(pinT2iModel({ id: 'x', scenes: [], character: { prompt: 'p', model: 'zimage' } }, 'qwen21').changed).toBe(false);
  });
});
