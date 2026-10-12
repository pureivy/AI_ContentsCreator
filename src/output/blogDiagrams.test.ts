import { describe, it, expect } from 'vitest';
import { extractStepsDiagram, insertDiagramMarkers, summaryInsertAt, validateSummaryItems, stripDiagramMarkers, pickEmoji, kickerEmoji } from './blogDiagrams';

// 2026-10-12 사장님 채택 — 글마다 설명 도표 2장(단풍나무 씨앗 글이 이미지 2장뿐이었다).
const MD = [
  '**요약**', '', '도입 문단.', '', '[IMAGE: 첫 장면]', '',
  '## 받은 씨앗은 어디에 뿌려야 할까요?', '반양지에 뿌리세요.', '',
  '1. 화분에 모래 섞인 흙을 채우고 표면을 평평하게 누릅니다.',
  '2. 씨앗을 흙 위에 놓습니다. 날개는 붙은 채로 둬도 됩니다.',
  '3. 씨 두께의 두 배쯤 흙을 덮습니다.',
  '', '뿌린 상자를 거실에 들이지 마세요. 따뜻하면 싹이 안 틉니다.', '', '---', '',
  '## 몇 년을 봐야 할까요?', '끝 문단입니다.',
].join('\n');

describe('extractStepsDiagram — 번호 목록 그대로', () => {
  it('제목은 절 소제목, 단계는 첫 문장·나머지는 작은 글씨, 같은 절 경고는 뒤 주의로', () => {
    const d = extractStepsDiagram(MD)!;
    expect(d.title).toBe('받은 씨앗은 어디에 뿌려야 할까요?');
    expect(d.items).toEqual([
      { text: '화분에 모래 섞인 흙을 채우고 표면을 평평하게 누릅니다', emoji: '🪴' },
      { text: '씨앗을 흙 위에 놓습니다', sub: '날개는 붙은 채로 둬도 됩니다', emoji: '🌱' },
      { text: '씨 두께의 두 배쯤 흙을 덮습니다', emoji: '🤲' },
    ]);
    expect(d.warnAfter).toEqual(['뿌린 상자를 거실에 들이지 마세요.']);
    // 번호 목록 바로 뒤(목록 마지막 줄 다음 줄) — 목록과 도표 사이에 다른 문단이 끼지 않게
    expect(MD.split('\n')[d.insertAt - 1]).toBe('3. 씨 두께의 두 배쯤 흙을 덮습니다.');
  });
  it('3단계 미만이면 없음', () => {
    expect(extractStepsDiagram('## a\n1. 하나\n2. 둘')).toBeNull();
  });
});

describe('validateSummaryItems — 본문 문장만, 새 수치 금지', () => {
  it('본문과 겹치는 칸만 남기고 본문에 없는 수치·지어낸 말은 버린다', () => {
    const items = validateSummaryItems(MD, [
      { label: '뿌릴 때', text: '반양지에 뿌리세요' },
      { label: '덮을 때', text: '씨 두께의 두 배쯤 흙을 덮습니다' },
      { label: '겨울', text: '3년 동안 비료를 주세요' },
      { label: '봄', text: '전혀 다른 이야기를 지어낸 문장입니다' },
    ]);
    expect(items.map((i) => i.label)).toEqual(['뿌릴 때', '덮을 때']);
  });
});

describe('insertDiagramMarkers — 마커 끼우기와 이미지 순서', () => {
  it('새 마커 순서대로 기존·도표 출처를 돌려준다', () => {
    const steps = extractStepsDiagram(MD)!;
    const r = insertDiagramMarkers(MD, [steps, { insertAt: summaryInsertAt(MD, steps.insertAt), alt: '요약 도표' }]);
    expect(r.order).toEqual([{ kind: 'old', i: 0 }, { kind: 'diagram', d: 0 }, { kind: 'diagram', d: 1 }]);
    expect(r.body).toContain('[IMAGE: 받은 씨앗은 어디에 뿌려야 할까요? 도표]');
    // 순서 도표는 목록 바로 뒤, 경고 문단보다 앞
    expect(r.body.indexOf('[IMAGE: 받은 씨앗은 어디에 뿌려야 할까요? 도표]')).toBeLessThan(r.body.indexOf('뿌린 상자를 거실에'));
  });
});

describe('stripDiagramMarkers — 리비전 런에 도표 자리를 넘기지 않는다', () => {
  it('"… 도표" 마커만 걷어 내고 사진 마커는 둔다', () => {
    const md = 'a\n\n[IMAGE: 첫 장면]\n\nb\n\n[IMAGE: 뿌리는 순서 도표]\n\nc';
    expect(stripDiagramMarkers(md)).toBe('a\n\n[IMAGE: 첫 장면]\n\nb\n\nc');
  });
});

describe('extractStepsDiagram — 작은 글씨는 문장 단위', () => {
  it('나머지가 여러 문장이면 첫 문장만, 중간에서 자르지 않는다', () => {
    const md = ['## 순서', '1. 하나를 합니다.', '2. 둘을 합니다.', '3. 상자를 바깥에 둡니다. 거실에 들이지 마세요. 따뜻한 데서 겨울을 보낸 씨앗은 봄이 와도 그대로 있습니다.'].join('\n');
    expect(extractStepsDiagram(md)!.items[2]).toMatchObject({ text: '상자를 바깥에 둡니다', sub: '거실에 들이지 마세요' });
  });
});

describe('pickEmoji·kickerEmoji — 칸 낱말로 결정적', () => {
  it('물·겨울·확인·주의는 그 이모지, 없으면 undefined', () => {
    expect(pickEmoji('물을 한 번 충분히 줍니다')).toBe('💧');
    expect(pickEmoji('상자를 바깥에 두고 겨울을 그대로 맞힙니다')).toBe('❄️');
    expect(pickEmoji('잎 갈래를 세어 보세요', '확인할 때')).toBe('🔍');
    expect(pickEmoji('거실에 들이지 마세요')).toBe('⚠️');
    expect(pickEmoji('그대로 둡니다')).toBeUndefined();
    expect(kickerEmoji('단풍나무 씨앗')).toBe('🍁');
    expect(kickerEmoji('모과나무 삽목')).toBe('🌳');
  });
});
