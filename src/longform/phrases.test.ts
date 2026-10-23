import { describe, expect, it } from 'vitest';
import { longCaptions, splitLongPhrases, twoLines } from './phrases';

const len = (s: string) => s.replace(/\s/g, '').length;

describe('splitLongPhrases', () => {
  it('쉼표 뒤에서 끊고, 뒷말에 붙는 말(자르면)을 앞 줄에 남기지 않는다', () => {
    const out = splitLongPhrases('어느 가지를 잘라야 할지 몰라서, 자르면 열매가 없어질까 봐 망설이게 됩니다.');
    expect(out[0]).toBe('어느 가지를 잘라야 할지 몰라서,');
    expect(out.some((p) => p.startsWith('자르면'))).toBe(true);
    expect(out.every((p) => !/자르면$/.test(p))).toBe(true);
  });
  it('연결 어미가 없으면 32자까지 한 구절, 5자 이하 꼬리는 남기지 않는다', () => {
    const s = '원줄기에서 갈라진 굵은 곁가지 중 3~4개를 골라 남깁니다. 고를 때 보는 자리는 세 곳입니다.';
    const out = splitLongPhrases(s);
    for (const p of out) { expect(len(p)).toBeLessThanOrEqual(32); expect(len(p)).toBeGreaterThan(5); }
    expect(out.join(' ').replace(/\s+/g, ' ')).toBe(s);
  });
  it('문장이 바뀌면 반드시 끊는다', () => {
    expect(splitLongPhrases('잎이 집니다. 가위를 듭니다.')).toEqual(['잎이 집니다.', '가위를 듭니다.']);
  });
});

describe('꾸밈 관계', () => {
  it('꾸미는 말과 꾸밈 받는 말 사이를 자르지 않는다', () => {
    const out = splitLongPhrases('어린 감나무는 남길 가지를 먼저 정합니다. 가장 굵고 똑바른 중심 줄기 하나부터 고르세요.');
    expect(out.some((p) => p.endsWith('중심'))).toBe(false);
    const out2 = splitLongPhrases('잎이 다 진 뒤부터 눈이 부풀기 전까지가 가위를 드는 시기입니다.');
    expect(out2.some((p) => p.endsWith('부풀기'))).toBe(false);
  });
});

describe('끊지 않는 결합', () => {
  it("'~에서'와 '~면 안 되다'에서는 끊지 않는다", () => {
    expect(splitLongPhrases('굵은 가지를 밑동에서 뗄 때는 줄기에 딱 붙여 자르지 않습니다.')).toHaveLength(1);
    expect(splitLongPhrases('마지막으로, 겨울에 가위를 들었을 때 자르면 안 되는 가지 세 가지입니다.').some((p) => p.endsWith('자르면'))).toBe(false);
  });
});

describe('나열', () => {
  it('명사 나열의 쉼표에서는 끊지 않는다', () => {
    const a = splitLongPhrases('오늘은 어린 과실나무 뼈대 잡는 법부터, 매실, 자두, 감나무, 블루베리를 차례로 봅니다.');
    expect(a.some((p) => p.endsWith('자두,'))).toBe(false);
    const b = splitLongPhrases('같은 높이에서 겹쳐 나온 가지는 하나만 남기고, 파고드는 가지, 처진 가지, 도장지를 밑동에서 잘라냅니다.');
    expect(b.some((p) => /가지,$/.test(p))).toBe(false);
  });
});

describe('긴 나열·두 줄', () => {
  const s = '자를 차례는 죽거나 병든 가지, 처진 가지, 속으로 파고드는 가지, 그리고 위로만 솟은 도장지입니다.';
  it("'그리고'에서 끊지 않고, 너무 긴 나열은 쉼표에서 나눈다", () => {
    const out = splitLongPhrases(s);
    expect(out.some((p) => p.endsWith('그리고'))).toBe(false);
    expect(out.every((p) => /,$|\.$/.test(p))).toBe(true);
  });
  it('22자를 넘는 구절은 쉼표·연결 어미 자리에서 줄을 바꾼다', () => {
    const caps = longCaptions('그래서 잎이 있을 때는 마른 가지와 뿌리목에서 올라온 순만 정리하고, 겨울에 없앨 가지를 정해 둡니다.', 300, 10);
    const two = caps.find((c) => c.text.includes('\n'));
    expect(two).toBeDefined();
    expect(two!.text.split('\n').every((l) => !/(?:처진|마른|병든|굵은)$/.test(l.trim()))).toBe(true);
  });
});

describe('줄바꿈 자리', () => {
  it('꾸미는 말 뒤·매인 말 앞에서는 줄을 바꾸지 않는다', () => {
    const bad = [/굵은\n/, /새\n/, /곁가지\n중/, /1~3년\n된/, /여섯\n유형/, /올라온\n순/, /부풀기\n전/, /자르면\n안/, /나무\n윗부분/, /가지\n수의/, /가지\n끝부분/];
    const lines = [
      '매실을 포함한 핵과류는 굵은 상처가 아무는 속도가 느리고,', '자두와 매실은 짧은 가지와 새 가지에 열매가 섞여 달리니,',
      '원줄기에서 갈라진 굵은 곁가지 중 3~4개를 골라 남깁니다.', '첫 번째 이야기는 심은 지 1~3년 된 어린 과실나무입니다.',
      '나머지 가지는 대부분 여섯 유형 중 하나에 들어갑니다.', '접목 자국 아래에서 올라온 순은 보이는 즉시 제거합니다.',
      '잎이 다 진 뒤부터 눈이 부풀기 전까지가 가위를 드는 시기입니다.', '마지막에는 자르면 안 되는 가지 세 가지를 정리합니다.',
      '그 가지를 지웠다고 상상했을 때 나무 윗부분에 뻥 뚫린 데가 생긴다면,', '한 해에 빼는 양은 전체 가지 수의 절반을 넘기지 않습니다.',
      '감·대추는 지난해 자란 가지 끝부분에 열매 눈이 있습니다.',
    ];
    for (const l of lines) { const t = twoLines(l); for (const b of bad) expect(t).not.toMatch(b); }
  });
});
