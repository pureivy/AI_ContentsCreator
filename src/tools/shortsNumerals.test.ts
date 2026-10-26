import { describe, it, expect } from 'vitest';
import { numeralsForDisplay, parseSinoNumber, fixSpokenDecimals, captionsFor, buildSrt, statSpoken, dropUnspokenStat } from './shortsCommon';
import { hasInfoCard } from '../orchestrator/shortsDirectMotion';

describe('fixSpokenDecimals — 낭독 소수점(2026-10-27 배나무 편)', () => {
  it('한글 수 사이 point·포인트 → 점', () => {
    expect(fixSpokenDecimals('키 십구point오미터예요.')).toBe('키 십구 점 오미터예요.');
    expect(fixSpokenDecimals('이 포인트 오 미터')).toBe('이 점 오 미터');
    expect(fixSpokenDecimals('일 Point 이 배')).toBe('일 점 이 배');
  });
  it('수 사이가 아니면 그대로', () => {
    expect(fixSpokenDecimals('포인트는 물빠짐이에요')).toBe('포인트는 물빠짐이에요');
    expect(fixSpokenDecimals('핵심 포인트 세 가지')).toBe('핵심 포인트 세 가지');
  });
});

describe('parseSinoNumber — 한자어 수', () => {
  it('자릿값', () => {
    expect(parseSinoNumber('이백오십')).toBe(250);
    expect(parseSinoNumber('십구')).toBe(19);
    expect(parseSinoNumber('십')).toBe(10);
    expect(parseSinoNumber('천오백')).toBe(1500);
    expect(parseSinoNumber('이만오천')).toBe(25000);
    expect(parseSinoNumber('영')).toBe(0);
  });
  it('수가 아닌 낱말은 null', () => {
    expect(parseSinoNumber('사이')).toBeNull();
    expect(parseSinoNumber('일일')).toBeNull();
    expect(parseSinoNumber('십백')).toBeNull();
  });
});

describe('numeralsForDisplay — 자막은 아라비아 숫자(2026-10-27 사장님)', () => {
  it('이번 사고 두 문장', () => {
    expect(numeralsForDisplay('정읍에 선 청실배나무는 수령 이백오십 년, 키가 십구 점 오 미터예요.'))
      .toBe('정읍에 선 청실배나무는 수령 250년, 키가 19.5m예요.');
    expect(numeralsForDisplay(fixSpokenDecimals('키 십구point오미터예요.'))).toBe('키 19.5m예요.');
    expect(numeralsForDisplay('키가 십구 미터 반이에요.')).toBe('키가 19.5m이에요.');
  });
  it('단위·비율·월', () => {
    expect(numeralsForDisplay('삼십 퍼센트쯤')).toBe('30%쯤');
    expect(numeralsForDisplay('영 점 오 미터')).toBe('0.5m');
    expect(numeralsForDisplay('이 년 반 뒤')).toBe('2년 반 뒤');
    expect(numeralsForDisplay('오십 센티미터 간격')).toBe('50cm 간격');
    expect(numeralsForDisplay('시월 중순에, 유월엔, 삼월부터')).toBe('10월 중순에, 6월엔, 3월부터');
    expect(numeralsForDisplay('십일월 초')).toBe('11월 초');
    expect(numeralsForDisplay('이십 그루를 심고 십오 일 뒤')).toBe('20그루를 심고 15일 뒤');
    expect(numeralsForDisplay('한 달에 이만사천 명, 오천 년 가까이')).toBe('한 달에 24,000명, 5,000년 가까이');
  });
  it('범위', () => {
    expect(numeralsForDisplay('삼사 미터')).toBe('3~4m');
    expect(numeralsForDisplay('사오월에')).toBe('4~5월에');
    expect(numeralsForDisplay('구시월엔')).toBe('9~10월엔');
    expect(numeralsForDisplay('오에서 십 미터')).toBe('5~10m');
    expect(numeralsForDisplay('이삼 년생 묘목')).toBe('2~3년생 묘목');
    expect(numeralsForDisplay('키는 일 이 미터에서 멈춰요')).toBe('키는 1~2m에서 멈춰요');
    expect(numeralsForDisplay('심은 지 일이 년이면')).toBe('심은 지 1~2년이면');
  });
  it('수로 시작하는 낱말·지시어는 그대로', () => {
    for (const s of [
      '이 시기엔 물을 줄여요', '오래된 배나무', '사과나무 옆', '일단 심어요', '백합처럼', '천천히 자라요', '세균이 번져요',
      '이 번엔 다르게', '이 가지를 잘라요', '이 배는 달아요', '오 분이면 돼요', '사이 간격', '구덩이를 파요',
      '이십 배나무', '삼십 분재', '오륙도', '두 그루', '한 해', '이월동 묘목', '일에서 손을 떼요', '딱 일주일이에요', '일이 많아요',
    ]) expect(numeralsForDisplay(s), s).toBe(s);
  });
  it('이미 숫자면 그대로', () => {
    expect(numeralsForDisplay('키 19.5m, 수령 250년')).toBe('키 19.5m, 수령 250년');
  });
});

describe('자막에만 적용 — 시각 배분은 낭독 기준', () => {
  it('captionsFor 는 숫자 표기, 프레임은 한글 글자 수로', () => {
    const narration = '수령 이백오십 년, 키가 십구 점 오 미터예요.';
    const caps = captionsFor(narration, 150);
    expect(caps.map((c) => c.text).join(' ')).toContain('250년');
    expect(caps.map((c) => c.text).join(' ')).toContain('19.5m예요.');
    expect(caps[caps.length - 1]!.endFrame).toBe(150);
  });
  it('구절 자막이 없는 씬(훅·CTA)의 SRT 도 숫자로', () => {
    expect(buildSrt([{ narration: '수령 이백오십 년이에요.', durationSec: 3 }])).toContain('수령 250년이에요.');
  });
});

describe('statSpoken·dropUnspokenStat — 숫자 카드는 그 씬에서 말한 수치만(2026-10-27 배나무 편)', () => {
  const scene2 = { narration: '마을 어귀 큰 배나무는 자리가 좋았던 나무예요. 품종보다 터가 더 크게 갑니다.', screenText: '답은 자리예요', kind: 'stat' as const, stat: { value: 250, unit: '년', label: '천연기념물 배나무 수령' } };
  it('이번 사고 — 씬2 는 250 을 말하지 않는다', () => {
    expect(statSpoken(scene2.narration, 250)).toBe(false);
    const out = dropUnspokenStat(scene2);
    expect(out.kind).toBeUndefined();
    expect(out.stat).toBeUndefined();
    expect(out.screenText).toBe('답은 자리예요');
    expect(hasInfoCard(scene2)).toBe(false);
  });
  it('한자어·고유어·숫자·소수로 말하면 카드 유지', () => {
    expect(statSpoken('정읍 청실배나무는 수령 이백오십 년이에요.', 250)).toBe(true);
    expect(statSpoken('키 십구 점 오 미터예요.', 19.5)).toBe(true);
    expect(statSpoken('키 십구point오미터예요.', 19.5)).toBe(true);
    expect(statSpoken('조건은 세 가지예요.', 3)).toBe(true);
    expect(statSpoken('개화 원인의 구십 퍼센트가 볕 부족이에요.', 90)).toBe(true);
    expect(statSpoken('한 달에 2만 4천 명이 찾아요.', 24000)).toBe(true);
    const ok = { ...scene2, narration: '수령 이백오십 년 된 나무예요.' };
    expect(dropUnspokenStat(ok)).toBe(ok);
    expect(hasInfoCard(ok)).toBe(true);
  });
});
