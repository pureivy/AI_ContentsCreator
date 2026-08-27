import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CONFIG } from '../config';
import {
  extractTimingNumbers, timingParityIssues, formatTimingIssue, stripUnsourcedStatOverlays,
} from './timingParity';

// CONFIG 는 런타임 가변 객체(readonly 는 타입 힌트일 뿐) — 킬스위치 테스트에서 강제하고 복원한다.
const cfg = CONFIG as unknown as { timingParity: boolean };
let orig: boolean;
beforeEach(() => { orig = cfg.timingParity; cfg.timingParity = true; });
afterEach(() => { cfg.timingParity = orig; });

describe('extractTimingNumbers — 결정적 추출·정규화', () => {
  it('월(숫자·고유어)을 숫자월로 정규화한다', () => {
    expect(extractTimingNumbers('9월 중순에 심습니다')).toContain('9월');
    expect(extractTimingNumbers('10 월에는 늦습니다')).toContain('10월'); // 공백 제거
    expect(extractTimingNumbers('시월에 심으세요')).toContain('10월');   // 고유어 → 숫자월
    expect(extractTimingNumbers('유월 장마')).toContain('6월');
    expect(extractTimingNumbers('정월 대보름')).toContain('1월');
    expect(extractTimingNumbers('십이월 한파')).toContain('12월');
  });
  it('절기명을 뽑는다', () => {
    expect(extractTimingNumbers('처서가 지나면')).toContain('처서');
    expect(extractTimingNumbers('입동 전에 마칩니다')).toContain('입동');
    expect(extractTimingNumbers('곡우 무렵')).toContain('곡우');
  });
  it('숫자+단위를 뽑고 ℃ 는 도로 정규화한다', () => {
    expect(extractTimingNumbers('깊이 20cm 로 팝니다')).toContain('20cm');
    expect(extractTimingNumbers('영하 10℃ 까지')).toContain('10도');
    expect(extractTimingNumbers('3개월 뒤')).toContain('3개월');
    expect(extractTimingNumbers('물 2리터')).toContain('2리터');
    expect(extractTimingNumbers('30% 정도')).toContain('30%');
  });
  it('단위 교대 순서 — 주일/주, ml/m 가 짧은 쪽으로 잘리지 않는다', () => {
    expect(extractTimingNumbers('2주일 간격')).toEqual(['2주일']);
    expect(extractTimingNumbers('2주 간격')).toEqual(['2주']);
    expect(extractTimingNumbers('50ml 씩')).toEqual(['50ml']);
    expect(extractTimingNumbers('간격 3m 확보')).toEqual(['3m']);
  });
  it('시각을 뽑되 시간(기간)은 시각으로 오인하지 않는다', () => {
    expect(extractTimingNumbers('오전 9시에 관수')).toContain('9시');
    expect(extractTimingNumbers('3시간 담가둡니다')).not.toContain('3시');
  });
  it('절기와 형태가 겹치는 상용어를 절기로 오인하지 않는다(하지만·하지 마세요·~에 대한·대한민국)', () => {
    expect(extractTimingNumbers('물을 주지 하지만 과습은 주의')).toEqual([]);
    expect(extractTimingNumbers('지금 옮기지 하지 마세요')).toEqual([]);
    expect(extractTimingNumbers('묘목에 대한 오해')).toEqual([]);
    expect(extractTimingNumbers('대한민국 어디서나')).toEqual([]);
    expect(extractTimingNumbers('필요하지 않습니다')).toEqual([]);
    expect(extractTimingNumbers('하지가 지나면 장마')).toContain('하지'); // 진짜 절기 용례는 살린다
  });
  it('천 단위 쉼표는 정규화로 흡수한다', () => {
    expect(extractTimingNumbers('1,200원 안팎')).toEqual(['1200원']);
    expect(extractTimingNumbers('1200원 안팎')).toEqual(['1200원']);
  });
  it('계절+시점은 너무 일반이라 뽑지 않는다', () => {
    expect(extractTimingNumbers('늦가을에 심습니다')).toEqual([]);
    expect(extractTimingNumbers('초봄이 좋습니다')).toEqual([]);
  });
  it('같은 토큰은 한 번만(중복 제거)', () => {
    expect(extractTimingNumbers('9월, 그리고 9월 말')).toEqual(['9월']);
  });
});

describe('timingParityIssues — 원문 대조', () => {
  const src = '## 심는 시기\n적기는 봄입니다. 9월에는 뿌리만 확인하세요. 구덩이는 20~30cm 깊이로 팝니다.';

  it('원문에 없는 토큰을 field·token·text 로 보고한다', () => {
    const issues = timingParityIssues(src, [{ field: '씬2 내레이션', text: '8월이 심기 좋은 때예요' }]);
    expect(issues).toEqual([{ field: '씬2 내레이션', token: '8월', text: '8월이 심기 좋은 때예요' }]);
  });
  it('원문에 같은 월이 있으면 통과한다(9월 vs 9월 중순)', () => {
    expect(timingParityIssues(src, [{ field: '자막', text: '9월 중순이 기준' }])).toEqual([]);
  });
  it('원문 범위 안의 값은 통과, 밖의 값은 검출(반올림은 인정하지 않는다)', () => {
    expect(timingParityIssues(src, [{ field: '본문', text: '25cm 깊이' }])).toEqual([]);
    expect(timingParityIssues(src, [{ field: '본문', text: '40cm 깊이' }])[0]?.token).toBe('40cm');
  });
  it('여러 파생 필드를 각각 대조하고 같은 field·token 중복은 접는다', () => {
    const issues = timingParityIssues(src, [
      { field: '씬1', text: '8월입니다. 8월이요.' },
      { field: '씬2', text: '처서 무렵' },
    ]);
    expect(issues.map((i) => `${i.field}/${i.token}`)).toEqual(['씬1/8월', '씬2/처서']);
  });
  it('TIMING_PARITY=off 면 빈 배열', () => {
    cfg.timingParity = false;
    expect(timingParityIssues(src, [{ field: '씬1', text: '8월이 적기' }])).toEqual([]);
  });
  it('원문이 비면 검사하지 않는다(파생이 아닌 단독 생성)', () => {
    expect(timingParityIssues('', [{ field: '씬1', text: '8월이 적기' }])).toEqual([]);
  });
  it('formatTimingIssue 는 수정 라운드용 한 줄을 만든다', () => {
    expect(formatTimingIssue({ field: '씬2 내레이션', token: '8월', text: '8월이 적기' }))
      .toBe('시기·수치 원문 불일치 — 씬2 내레이션: "8월이 적기" (원문에 없는 8월)');
  });
});

describe('stripUnsourcedStatOverlays — stat 오버레이 결정적 제거', () => {
  const src = '적기는 봄입니다. 9월에는 뿌리만 확인하세요.';

  it('원문에 없는 수치는 오버레이(kind·stat)를 통째로 제거하고 값을 보고한다', () => {
    const scenes = [
      { kind: 'stat' as const, stat: { value: 8, unit: '월', label: '낙엽수 식재 시작' } },
      { kind: 'stat' as const, stat: { value: 9, unit: '월', label: '뿌리 확인' } },
    ];
    const r = stripUnsourcedStatOverlays(scenes, src);
    expect(r.removed).toEqual(['8월']);
    expect(r.scenes[0]).toEqual({});            // {} 강등 — normalizeSceneKind 와 같은 표현
    expect(r.scenes[1]).toEqual(scenes[1]);     // 원문에 있는 9월은 유지
  });
  it('내레이션·자막 등 다른 필드는 보존한다', () => {
    const scenes = [{ narration: '지금이 적기', screenText: '적기', kind: 'stat' as const, stat: { value: 8, unit: '월' } }];
    expect(stripUnsourcedStatOverlays(scenes, src).scenes[0]).toEqual({ narration: '지금이 적기', screenText: '적기' });
  });
  it('단위 없는 자명한 숫자(단계 수·항목 수)는 대조 불가라 건드리지 않는다', () => {
    const scenes = [{ kind: 'stat' as const, stat: { value: 3, label: '단계' } }];
    expect(stripUnsourcedStatOverlays(scenes, src).removed).toEqual([]);
  });
  it('stat 이 아닌 kind 는 결정적 제거 대상이 아니다', () => {
    const scenes = [{ kind: 'chart' as const, chart: { series: [{ label: '봄', value: 90 }, { label: '가을', value: 70 }] } }];
    expect(stripUnsourcedStatOverlays(scenes, src).removed).toEqual([]);
  });
  it('TIMING_PARITY=off 면 제거도 하지 않는다', () => {
    cfg.timingParity = false;
    const scenes = [{ kind: 'stat' as const, stat: { value: 8, unit: '월' } }];
    const r = stripUnsourcedStatOverlays(scenes, src);
    expect(r.removed).toEqual([]);
    expect(r.scenes[0]).toEqual(scenes[0]);
  });
  it('원문이 비면 제거하지 않는다', () => {
    const scenes = [{ kind: 'stat' as const, stat: { value: 8, unit: '월' } }];
    expect(stripUnsourcedStatOverlays(scenes, '').removed).toEqual([]);
  });
});

// 보고서 §6 권고 1 의 실사고 — 블로그는 "가을이 낫다는 근거는 확실치 않다"인데 같은 소재 쇼츠가
// 내레이션·자막·화면 수치 세 군데에서 8월을 적기로 단정했다(2026-08-27 활엽수 편).
describe('활엽수 사고 재현(acceptance)', () => {
  const blog = [
    '## 나무 심는 적기',
    '나무 심는 적기는 보통 봄입니다. 가을이 봄보다 낫다고 말할 근거는 확실치 않습니다.',
    '잎을 다 떨군 나무는 수분 손실이 줄거든요.',
  ].join('\n');

  it('내레이션·자막의 8월을 잡고, 오버레이 8월은 제거한다', () => {
    const issues = timingParityIssues(blog, [
      { field: '씬2 내레이션', text: '잎 지는 나무는 8월이 심기 좋은 때예요' },
      { field: '씬2 자막', text: '8월 낙엽나무는 적기' },
      { field: '씬3 오버레이', text: '8월 · 낙엽수 식재 시작' },
    ]);
    expect(issues.map((i) => i.token)).toEqual(['8월', '8월', '8월']);
    expect(formatTimingIssue(issues[0]!))
      .toBe('시기·수치 원문 불일치 — 씬2 내레이션: "잎 지는 나무는 8월이 심기 좋은 때예요" (원문에 없는 8월)');

    const scenes = [{ narration: '잎 지는 나무는 8월이 심기 좋은 때예요', kind: 'stat' as const, stat: { value: 8, unit: '월', label: '낙엽수 식재 시작' } }];
    const r = stripUnsourcedStatOverlays(scenes, blog);
    expect(r.removed).toEqual(['8월']);
    expect(r.scenes[0]).toEqual({ narration: '잎 지는 나무는 8월이 심기 좋은 때예요' });
  });
});
