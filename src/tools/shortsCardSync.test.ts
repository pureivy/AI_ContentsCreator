import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  cardHeaderFor, headerCandidates, parseSilencedetect, alignSegments, cardElements, cardBeats,
  probeSpeechTimeline, titleBottomPx, BEAT_MIN_GAP, BEAT_READ_TAIL, headerCount,
} from './shortsCardSync';
import { stageAndBuildProps } from './shortsRenderRemotion';
import { CONFIG } from '../config';
import type { ShortsScene, PreparedScene } from './shortsCommon';

// 파일럿 두 편(2026-10-05)의 실제 대본 — 머리줄·박자 규칙의 기준 사례.
const FE6_COMPARE: ShortsScene = {
  narration: '잎 남은 가지를 지금 자르면 새 순이 늦게 올라와 첫추위를 못 넘겨요. 전정은 낙엽 끝난 뒤로 미루세요.',
  screenText: '잎 있을 때 자르면 위험', kind: 'compare',
  compare: { bad: { label: '잎 있을 때 전정', note: '새 순 늦어 첫추위 위험' }, good: { label: '낙엽 후 전정', note: '잎 다 떨어진 뒤 자르기' } },
};
const FE6_LIST: ShortsScene = {
  narration: '보온은 심은 지 한두 해 된 어린나무가 우선이에요. 뿌리가 덜 퍼져서 언 땅 영향을 바로 받거든요.',
  screenText: '어린나무부터 보온', kind: 'list',
  items: ['올해·작년에 심은 나무', '여러 겨울 넘긴 나무', '바람 지나는 자리', '화분 심은 나무'],
};
const B601_COMPARE: ShortsScene = {
  narration: '작고 비슷해 보이는 열매는 명자나무로 흔히 오해해요. 모과는 익으면서 향이 나무 주변까지 퍼지는 게 다릅니다.',
  screenText: '향으로 구분해요', kind: 'compare',
  compare: { bad: { label: '명자나무로 오해', note: '작고 비슷해 보여서' }, good: { label: '모과나무는 향 퍼짐', note: '익으면서 향이 퍼져요' } },
};
const B601_CTA: ShortsScene = {
  narration: '향과 처진 가지, 그리고 봄 꽃. 이 세 가지면 헛갈릴 일 없어요.',
  screenText: '향·가지·꽃으로 확인', kind: 'cta',
  takeaways: [{ when: '가지가 휘었다면', then: '모과나무' }, { when: '향이 멀리 퍼지면', then: '모과나무' }],
};

describe('cardHeaderFor — 대본 문장 그대로의 결론 한 줄', () => {
  it('파일럿 사례: 카드와 겹치는 말이 많은 문장, 같으면 뒤쪽', () => {
    expect(cardHeaderFor(FE6_COMPARE)).toBe('전정은 낙엽 끝난 뒤로 미루세요');
    // 2026-10-05: 두 줄 카드에 '세 가지' 머리줄은 개수 어긋남, 명사 나열은 결론이 아님 → 머리줄 없음.
    expect(cardHeaderFor(B601_CTA)).toBeUndefined();
  });
  it('긴 문장은 마지막 절(서술어를 가진 쪽)만 — 새 글자를 만들지 않는다', () => {
    const h = cardHeaderFor(B601_COMPARE)!;
    expect(h).toBe('향이 나무 주변까지 퍼지는 게 다릅니다');
    expect(B601_COMPARE.narration.includes(h)).toBe(true);
  });
  it('고를 게 없으면 없음 — 긴 문장뿐이거나 까닭 설명(거든요)만 남는 씬', () => {
    expect(cardHeaderFor(FE6_LIST)).toBeUndefined();
  });
  it('질문·라벨과 같은 말·카드와 무관한 말은 머리줄이 아니다', () => {
    const base = { kind: 'list' as const, items: ['물 주기 간격', '흙 마름 확인'] };
    expect(cardHeaderFor({ ...base, narration: '물 주기 간격은 어떻게 정할까요?' })).toBeUndefined();
    expect(cardHeaderFor({ ...base, narration: '흙 마름을 먼저 확인하세요.', screenText: '흙 마름을 먼저 확인하세요' })).toBeUndefined();
    expect(cardHeaderFor({ ...base, narration: '오늘 날씨가 참 좋습니다.' })).toBeUndefined();
    expect(cardHeaderFor({ ...base, narration: '흙 마름을 먼저 확인하세요.' })).toBe('흙 마름을 먼저 확인하세요');
  });
  it('카드가 없는 씬(훅·무연출·quote)은 머리줄 없음', () => {
    expect(cardHeaderFor({ narration: '전정은 낙엽 뒤로 미루세요.', kind: 'hook' })).toBeUndefined();
    expect(cardHeaderFor({ narration: '전정은 낙엽 뒤로 미루세요.' })).toBeUndefined();
    expect(cardHeaderFor({ narration: '전정은 낙엽 뒤로 미루세요.', kind: 'quote', quote: { text: '전정' } })).toBeUndefined();
  });
  it('후보는 결정적이고 끝 문장부호를 뗀다', () => {
    const n = '보온은 지금 눈으로 정하고, 가위는 낙엽 뒤로 미루세요. 자른 자리는 눈 위에서 끊어야 해요.';
    expect(headerCandidates(n)).toEqual(['가위는 낙엽 뒤로 미루세요', '자른 자리는 눈 위에서 끊어야 해요']);
    expect(headerCandidates(n)).toEqual(headerCandidates(n));
  });
});

describe('parseSilencedetect — 앞뒤 무음은 낭독 구간 밖, 가운데만 쉼', () => {
  const out = [
    '[silencedetect @ 0x1] silence_start: 0', '[silencedetect @ 0x1] silence_end: 0.21 | silence_duration: 0.21',
    '[silencedetect @ 0x1] silence_start: 3.982245', '[silencedetect @ 0x1] silence_end: 4.517937 | silence_duration: 0.53',
    '[silencedetect @ 0x1] silence_start: 6.08932',
  ].join('\n');
  it('가운데 쉼·첫 소리·마지막 소리', () => {
    const tl = parseSilencedetect(out, 6.501587);
    expect(tl.speechStart).toBeCloseTo(0.21, 3);
    expect(tl.speechEnd).toBeCloseTo(6.08932, 4);
    expect(tl.pauses).toEqual([{ start: 3.982245, end: 4.517937 }]);
  });
  it('무음이 하나도 없으면 파일 전체가 낭독', () => {
    expect(parseSilencedetect('', 3)).toEqual({ durationSec: 3, speechStart: 0, speechEnd: 3, pauses: [] });
  });
});

describe('alignSegments — 문장·쉼표 경계를 실제 쉼에 짝짓기', () => {
  it('경계 수만큼 쉼이 있으면 쉼 시작·끝이 절 경계', () => {
    const tl = { durationSec: 6.5, speechStart: 0, speechEnd: 6.09, pauses: [{ start: 3.98, end: 4.52 }] };
    const segs = alignSegments(FE6_COMPARE.narration, tl);
    expect(segs.map((s) => [s.startSec, s.endSec])).toEqual([[0, 3.98], [4.52, 6.09]]);
  });
  it('숨 쉼(짧은 쉼)이 섞여도 추정 시각에 가까운 쉼을 고른다', () => {
    const tl = { durationSec: 7.15, speechStart: 0, speechEnd: 6.68, pauses: [{ start: 1.39, end: 1.53 }, { start: 3.09, end: 3.58 }, { start: 4.82, end: 4.98 }] };
    const segs = alignSegments(B601_COMPARE.narration, tl);
    expect(segs[1]!.startSec).toBeCloseTo(3.58, 2);
  });
  it('쉼이 경계보다 적으면 남는 경계는 글자 비례 추정(break 태그 3개 상한)', () => {
    const tl = { durationSec: 5, speechStart: 0, speechEnd: 5, pauses: [] };
    const segs = alignSegments('가나다라마. 바사아자차.', tl);
    expect(segs[0]!.endSec).toBeCloseTo(2.5, 5);
    expect(segs[1]!.startSec).toBeCloseTo(2.5, 5);
  });
});

describe('cardBeats — 요소를 말하는 순간에 맞춘 등장 프레임', () => {
  const fe6Segs = alignSegments(FE6_COMPARE.narration, { durationSec: 6.5, speechStart: 0, speechEnd: 6.09, pauses: [{ start: 3.98, end: 4.52 }] });
  it('대비: ✕ 는 첫 문장 시작, ✓ 는 "전정은 낙엽…" 이 시작되는 쉼 끝(3프레임 앞당김)', () => {
    expect(cardBeats(cardElements(FE6_COMPARE)!, fe6Segs, 213)).toEqual([0, Math.round(4.52 * 30) - 3]);
  });
  it('목록: 인정된 항목은 낭독 시각, 못 찾은 항목은 이웃 사이 등분 — 순서·최소 간격 보장', () => {
    const segs = alignSegments(FE6_LIST.narration, { durationSec: 6.2, speechStart: 0, speechEnd: 5.87, pauses: [{ start: 2.9, end: 3.43 }] });
    const b = cardBeats(cardElements(FE6_LIST)!, segs, 205)!;
    expect(b).toHaveLength(4);
    for (let i = 1; i < b.length; i++) expect(b[i]! - b[i - 1]!).toBeGreaterThanOrEqual(BEAT_MIN_GAP);
    expect(b[b.length - 1]!).toBeLessThanOrEqual(205 - BEAT_READ_TAIL);
  });
  it('하나도 못 찾으면 undefined — 종전 박자(fail-open)', () => {
    const segs = alignSegments(B601_CTA.narration, { durationSec: 4.55, speechStart: 0, speechEnd: 4.3, pauses: [] });
    expect(cardBeats(cardElements(B601_CTA)!, segs, 155)).toBeUndefined();
    expect(cardBeats([], segs, 155)).toBeUndefined();
    expect(cardBeats(['아무거나'], [], 155)).toBeUndefined();
  });
  it('끝자락에 말하는 요소는 읽을 시간 선(씬 끝 − 1.5초)까지 당기고, 그마저 안 되는 짧은 씬은 undefined', () => {
    expect(cardBeats(cardElements(FE6_COMPARE)!, fe6Segs, 140)).toEqual([0, 140 - BEAT_READ_TAIL]);
    expect(cardBeats(cardElements(FE6_COMPARE)!, fe6Segs, 50)).toBeUndefined();
  });
  it('결정적 — 같은 입력이면 같은 박자', () => {
    expect(cardBeats(cardElements(FE6_COMPARE)!, fe6Segs, 213)).toEqual(cardBeats(cardElements(FE6_COMPARE)!, fe6Segs, 213));
  });
});

describe('titleBottomPx — 캘리 실제 아래 끝', () => {
  it('가로로 긴 캘리는 폭 기준, 세로로 긴 캘리는 26% 상자에서 멈춘다', () => {
    expect(titleBottomPx({ w: 1400, h: 564 }, 5, 74)).toBe(Math.round(96 + (799.2 * 564) / 1400));
    expect(titleBottomPx({ w: 500, h: 2000 }, 5, 74)).toBe(Math.round(96 + 1920 * 0.26));
    expect(titleBottomPx({ w: 0, h: 10 })).toBeUndefined();
  });
});

describe('probeSpeechTimeline — 실제 mp3 의 쉼(ffmpeg)', () => {
  it('소리 1초 · 쉼 0.5초 · 소리 1초 → 가운데 쉼 하나', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsync-'));
    const f = path.join(dir, 'n.mp3');
    try {
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-filter_complex', '[1]atrim=0:0.5[s];[0][s][2]concat=n=3:v=0:a=1', f]);
      const tl = (await probeSpeechTimeline(f))!;
      expect(tl.pauses).toHaveLength(1);
      expect(tl.pauses[0]!.start).toBeGreaterThan(0.9);
      expect(tl.pauses[0]!.end).toBeLessThan(1.6);
      expect(await probeSpeechTimeline(path.join(dir, 'none.mp3'))).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stageAndBuildProps — SHORTS_CARD_MOTION_V2 킬스위치', () => {
  const cfg = CONFIG as unknown as { shortsCardMotionV2: boolean };
  const prepared: PreparedScene[] = [{
    index: 0, imagePath: null, audioPath: null, screenText: FE6_COMPARE.screenText!, narration: FE6_COMPARE.narration,
    durationSec: 7.1, durationInFrames: 213, startFrame: 0,
  }];
  const run = async (on: boolean): Promise<Record<string, unknown>> => {
    const was = cfg.shortsCardMotionV2;
    cfg.shortsCardMotionV2 = on;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardsync-pub-'));
    try {
      const props = await stageAndBuildProps(dir, prepared, [FE6_COMPARE]);
      return (props.scenes as Array<Record<string, unknown>>)[0]!;
    } finally {
      cfg.shortsCardMotionV2 = was;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  it('끄면 card 필드 자체가 없고, 켜도 card 말고는 한 글자도 안 바뀐다', async () => {
    const off = await run(false);
    expect('card' in off).toBe(false);
    const { card: _card, ...rest } = await run(true);
    expect(rest).toEqual(off);
  });
  it('켜면 머리줄이 실리고, 낭독 파일이 없으면 박자는 없다(종전 박자로 fail-open)', async () => {
    expect((await run(true)).card).toEqual({ header: '전정은 낙엽 끝난 뒤로 미루세요' });
  });
});

describe('머리줄 개수 어긋남 거름(2026-10-05 모과 결론 카드 — 두 줄 카드에 "이 세 가지면")', () => {
  it('headerCount — 수량을 세는 말만 읽는다', () => {
    expect(headerCount('이 세 가지면 헛갈릴 일 없어요')).toBe(3);
    expect(headerCount('두 곳만 보면 됩니다')).toBe(2);
    expect(headerCount('3단계로 끝나요')).toBe(3);
    expect(headerCount('세 번째 가지는 남겨요')).toBeUndefined();
    expect(headerCount('향으로 구분해요')).toBeUndefined();
  });
  it('카드 항목 수와 다른 개수를 말하는 머리줄은 쓰지 않는다', () => {
    const sc = {
      kind: 'cta' as const, narration: '이 세 가지면 헛갈릴 일 없어요.',
      takeaways: [{ when: '가지가 휘었다면', then: '모과나무' }, { when: '향이 멀리 퍼지면', then: '모과나무' }],
    };
    expect(cardHeaderFor(sc)).toBeUndefined();
    const three = { ...sc, takeaways: [...sc.takeaways, { when: '봄 꽃이 분홍이면', then: '모과나무' }] };
    expect(cardHeaderFor(three)).toBe('이 세 가지면 헛갈릴 일 없어요');
  });
});
