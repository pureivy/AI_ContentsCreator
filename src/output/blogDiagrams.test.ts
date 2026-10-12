import { describe, it, expect } from 'vitest';
import { extractStepsDiagram, insertDiagramMarkers, summaryInsertAt, validateSummaryItems } from './blogDiagrams';

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
      { text: '화분에 모래 섞인 흙을 채우고 표면을 평평하게 누릅니다' },
      { text: '씨앗을 흙 위에 놓습니다', sub: '날개는 붙은 채로 둬도 됩니다' },
      { text: '씨 두께의 두 배쯤 흙을 덮습니다' },
    ]);
    expect(d.warnAfter).toEqual(['뿌린 상자를 거실에 들이지 마세요.']);
    expect(MD.split('\n')[d.insertAt]).toBe(''); // 절 끝(빈 줄·구분선 앞)
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
    // 순서 도표가 마지막 절 바로 앞이라 요약 도표는 마지막 절 끝으로(두 도표가 붙지 않게)
    expect(r.body.indexOf('[IMAGE: 요약 도표]')).toBeGreaterThan(r.body.indexOf('끝 문단입니다.'));
  });
});
