import { describe, it, expect } from 'vitest';
import {
  normalizeLayout, alignRawSlides, insideDir, coverage, sourceSentences, extractOk, monthMentioned, parsePhotoRef, layoutFields, dropFields, parityKeys, oneEmoji, toRenderSpec, genPhotoPrompt, dedupeBlogPhotos, realPhotoSlots,
} from './cardLayout';

// 감나무 잎 구별 글(2026-10-12)에서 줄인 원문 — 카드 칸은 여기서만 뽑아야 한다.
const SRC = [
  '## 산감나무, 돌감나무는 다른 나무인가요?',
  '같은 나무입니다. 열매 크기와 자란 자리가 달라서 부르는 말이 나뉜 것이고, 종이 갈라지지는 않아요.',
  '- **잎**: 크고 넓으며 가장자리에 톱니가 없고, 녹색 광택이 납니다.',
  '- **수피(나무껍질)**: 흑회색으로 코르크처럼 되어 잘게 갈라지고, 숨구멍 자리인 피목이 많습니다.',
  '다 자라면 키가 10~15m까지 올라가는 낙엽성 교목이라, 산에 선 감나무는 생각보다 큽니다.',
  '꽃은 5~6월에 이미 지나갔어요. 지금은 10월, 열매가 등황색으로 물드는 시기입니다.',
].join('\n');
const PLAN = {
  title: '감나무 잎 구별',
  slides: [
    { headline: '산길의 작은 감, 감나무일까요?', body: '잎 테두리부터 보면 됩니다' },
    { headline: '세 군데로 알아봅니다', body: '' },
    { headline: '산에 선 감나무는 큽니다', body: '' },
    { headline: '이번 주말 이 순서로', body: '' },
  ],
};

describe('coverage·extractOk — 칸 글은 원문 문장에서 뽑은 것만', () => {
  const sents = sourceSentences(SRC);
  it('원문을 줄인 칸은 통과', () => {
    expect(coverage('톱니가 없고 광택이 나요', sents)).toBeGreaterThanOrEqual(0.5);
    expect(extractOk('흑회색, 잘게 갈라져요', SRC, sents)).toBe(true);
  });
  it('원문에 없는 내용·숫자는 탈락', () => {
    expect(extractOk('가을에 붉은 단풍이 아름다워요', SRC, sents)).toBe(false);
    expect(extractOk('키가 20m까지 자라요', SRC, sents)).toBe(false);
  });
});

describe('monthMentioned — 달력 칸은 원문이 말한 달만', () => {
  it('범위와 단일 월을 모두 읽는다', () => {
    expect(monthMentioned(SRC, 5)).toBe(true);
    expect(monthMentioned(SRC, 6)).toBe(true);
    expect(monthMentioned(SRC, 10)).toBe(true);
    expect(monthMentioned(SRC, 7)).toBe(false);
    expect(monthMentioned(SRC, 1)).toBe(false); // "10월"·"15m" 의 1 에 걸리지 않는다
  });
});

describe('parsePhotoRef', () => {
  it('블로그 번호는 범위 안만, gen 은 장면이 있어야', () => {
    expect(parsePhotoRef({ use: 'blog', n: 2 }, 3)).toEqual({ use: 'blog', n: 2 });
    expect(parsePhotoRef({ use: 'blog', n: 5 }, 3)).toBeUndefined();
    expect(parsePhotoRef('blog:1', 3)).toEqual({ use: 'blog', n: 1 });
    expect(parsePhotoRef({ use: 'gen', scene: '손바닥 위 매끈한 감나무 잎', must_show: ['톱니 없는 테두리'] }, 0))
      .toEqual({ use: 'gen', scene: '손바닥 위 매끈한 감나무 잎', must: { show: ['톱니 없는 테두리'], not: [] } });
    expect(parsePhotoRef({ use: 'gen', scene: '잎' }, 0)).toBeUndefined();
  });
});

describe('file 사진은 카드 폴더 안만 — 보안 검토 2026-10-12', () => {
  it('폴더 밖·상위 경로는 거부', () => {
    expect(insideDir('/tmp/card/photos/a.png', '/tmp/card')).toBe(true);
    expect(insideDir('/etc/passwd', '/tmp/card')).toBe(false);
    expect(insideDir('/tmp/card/../other/a.png', '/tmp/card')).toBe(false);
    expect(insideDir('/tmp/card', '/tmp/card')).toBe(false);
    expect(parsePhotoRef({ use: 'file', path: '/etc/hosts' }, 0, '/tmp/card')).toBeUndefined();
    expect(parsePhotoRef({ use: 'file', path: '/etc/hosts' }, 0)).toBeUndefined();
  });
});

describe('normalizeLayout — 장 수·판 고정·칸 검증', () => {
  const raw = {
    series: '산길 나무 구별 노트',
    slides: [
      { kind: 'points', accent: '감나무', kicker: '🍊 감나무 편' }, // 1번은 cover 로 고정
      { kind: 'points', items: [
        { emoji: '🍃', label: 'CHECK 1', title: '잎', text: '톱니가 없고 광택이 나요' },
        { emoji: '🪵', label: 'CHECK 2', title: '수피', text: '흑회색, 잘게 갈라져요' },
        { emoji: '🌸', label: 'CHECK 3', title: '꽃', text: '봄에 분홍 꽃이 핍니다' }, // 원문에 없음 → 버림
      ] },
      { kind: 'numbers', stats: [{ value: '10~15m', label: '다 자란 키' }, { value: '30m', label: '최대 키' }],
        calendar: [{ months: [5, 6], label: '5~6월 꽃' }, { months: [7], label: '7월 장마' }] },
      { kind: 'photo' }, // 마지막은 steps 로 고정
    ],
  };
  const l = normalizeLayout(raw, PLAN, SRC, 2);
  it('표지·마무리 판을 고정하고 제목·본문은 기획 문구 그대로', () => {
    expect(l.slides.map((s) => s.kind)).toEqual(['cover', 'points', 'numbers', 'steps']);
    expect(l.slides[0]!.title).toBe(PLAN.slides[0]!.headline);
    expect(l.slides[0]!.lead).toBe('잎 테두리부터 보면 됩니다');
    expect(l.slides[0]!.accent).toBe('감나무');
    expect(l.series).toBe('산길 나무 구별 노트');
  });
  it('원문에 없는 칸은 버린다', () => {
    expect(l.slides[1]!.items!.map((x) => x.title)).toEqual(['잎', '수피']);
    expect(l.slides[2]!.stats!.map((x) => x.value)).toEqual(['10~15m']);
    expect(l.slides[2]!.calendar!.map((x) => x.months)).toEqual([[5, 6]]);
  });
  it('칸이 모자라면 photo 판으로 내린다', () => {
    const l2 = normalizeLayout({ slides: [{}, { kind: 'points', items: [{ title: '잎', text: '톱니가 없고 광택이 나요' }] }, { kind: 'facts', rows: [] }, {}] }, PLAN, SRC, 0);
    expect(l2.slides.map((s) => s.kind)).toEqual(['cover', 'photo', 'photo', 'steps']);
  });
  it('제목에 없는 강조어는 버린다', () => {
    const l3 = normalizeLayout({ slides: [{ accent: '없는말' }] }, PLAN, SRC, 0);
    expect(l3.slides[0]!.accent).toBeUndefined();
  });
});

describe('칸 사실 대조 — 걸린 칸 지우기', () => {
  const l = normalizeLayout({ slides: [{}, { kind: 'points', items: [
    { title: '잎', text: '톱니가 없고 광택이 나요' }, { title: '수피', text: '흑회색, 잘게 갈라져요' },
  ] }, {}, {}] }, PLAN, SRC, 0);
  const fields = layoutFields(l);
  it('parity "항목N" 을 칸 주소로', () => {
    expect(fields.map((f) => f.key)).toEqual(['1.items.0', '1.items.1']);
    expect([...parityKeys(['항목2: 원문은 …'], fields)]).toEqual(['1.items.1']);
  });
  it('지워서 항목이 1개가 되면 photo 판으로', () => {
    const d = dropFields(l, new Set(['1.items.1']));
    expect(d.slides[1]!.kind).toBe('photo');
    expect(d.slides[1]!.title).toBe('세 군데로 알아봅니다');
  });
});

describe('oneEmoji·toRenderSpec', () => {
  it('이모지 한 글자만', () => {
    expect(oneEmoji('🍃 잎')).toBe('🍃');
    expect(oneEmoji('잎')).toBeUndefined();
  });
  it('사진 자리를 경로로, 표지에 촬영 꼬리표', () => {
    const l = normalizeLayout({ slides: [{ photo: { use: 'blog', n: 1 } }, {}, {}, {}] }, PLAN, SRC, 1);
    const spec = toRenderSpec(l, (r) => (r?.use === 'blog' ? '/x/blog-01.png' : undefined), { outDir: '/o', fontDir: '/f', brand: { name: 'B' }, coverNote: '📷 실제 촬영' }) as { slides: Array<{ photo?: string; photoNote?: string }> };
    expect(spec.slides[0]!.photo).toBe('/x/blog-01.png');
    expect(spec.slides[0]!.photoNote).toBe('📷 실제 촬영');
    expect(spec.slides[1]!.photo).toBeUndefined();
  });
});

import { dropSelfCleared } from './standaloneQa';
describe('dropSelfCleared — 검수자가 스스로 무혐의라 적은 줄은 보류로 세지 않는다(2026-10-12 자두나무 카드)', () => {
  it('끝이 "문제 없음/아님 — 보고 생략" 인 줄만 뺀다', () => {
    expect(dropSelfCleared([
      "6: 원문 절차와 일치하므로 문제 아님 — 보고 생략",
      "9: '그 아래까지'로 요약, 결론 일치 — 문제 없음",
      '항목3: 원문에 없는 약제 이름이 들어갔다',
    ])).toEqual(['항목3: 원문에 없는 약제 이름이 들어갔다']);
  });
  it('"보고 생략 가능"으로 끝나는 줄도 뺀다(2026-10-15 소나무 숏폼)', () => {
    expect(dropSelfCleared([
      "항목3: 텍스트는 목록에서 '좌우 2미터 미만'을 제시하면서도 명확한 왜곡은 없음 — 보고 생략 가능",
      '항목2: 원문에 없는 문턱 기준을 새로 단정함',
    ])).toEqual(['항목2: 원문에 없는 문턱 기준을 새로 단정함']);
  });
  it('"사실 왜곡은 없음"으로 끝나는 줄도 뺀다, 중간에 "없음"이 있는 진짜 지적은 남긴다(2026-10-14 감나무 숏폼)', () => {
    expect(dropSelfCleared([
      "항목4: 원문은 수피 근거 세 가지를 제시했는데, 텍스트는 '잘게 갈라짐'만 언급하여 단순화했으나 사실 왜곡은 없음",
      "항목5: 원문은 세 가지 확인을 제시했는데, 텍스트는 '두 가지만 맞으면 감나무'라고 단정하여 하나를 누락",
      '항목2: 원문에 없음 — 근거 없는 수치 "10~15m"가 들어갔다',
    ])).toEqual([
      "항목5: 원문은 세 가지 확인을 제시했는데, 텍스트는 '두 가지만 맞으면 감나무'라고 단정하여 하나를 누락",
      '항목2: 원문에 없음 — 근거 없는 수치 "10~15m"가 들어갔다',
    ]);
  });
});

describe('genPhotoPrompt — 같은 세트 사진 잇기(2026-10-15)', () => {
  it('세트 사진을 참조로 받으면 같은 나무·같은 밭으로 그리라고 한다, 어린 나무면 그 단계를 지키라고 덧붙인다', () => {
    const p = genPhotoPrompt('가지를 구부리는 손', undefined, '호두나무 — 깃꼴겹잎', { setRefs: true, young: true });
    expect(p).toContain('[첨부 사진 — 이 카드뉴스의 다른 장 사진]');
    expect(p).toContain('이 글의 나무는 어린 나무다');
  });
  it('참조가 없으면 종전 문구 그대로', () => {
    expect(genPhotoPrompt('장면', undefined, '호두나무')).not.toContain('첨부 사진');
  });
});

describe('dedupeBlogPhotos — 같은 블로그 사진은 세트에서 한 번만(2026-10-15)', () => {
  const L = () => ({ series: 's', slides: [
    { kind: 'cover', title: '표지', photo: { use: 'blog', n: 1 } },
    { kind: 'photo', title: '가지 끝을 구부려 보기', lead: '탄력 있으면\n살아 있어요', photo: { use: 'blog', n: 2 } },
    { kind: 'photo', title: '밑동을 흔들어 보기', photo: { use: 'blog', n: 2 } },
    { kind: 'photo', title: '흙을 다지기', photo: { use: 'blog', n: 1 } },
  ] }) as never;
  it('두 번째 쓰임부터 새 사진(gen)으로 — 장면은 그 장의 제목·내용', () => {
    const l = L() as { slides: Array<{ photo?: { use: string; scene?: string; n?: number } }> };
    expect(dedupeBlogPhotos(l as never, 6)).toBe(2);
    expect(l.slides[0]!.photo).toEqual({ use: 'blog', n: 1 });
    expect(l.slides[1]!.photo).toEqual({ use: 'blog', n: 2 });
    expect(l.slides[2]!.photo!.use).toBe('gen');
    expect(l.slides[2]!.photo!.scene).toContain('밑동을 흔들어 보기');
    expect(l.slides[3]!.photo!.use).toBe('gen');
  });
  it('새 사진 몫을 다 쓰면 반복을 그대로 둔다', () => {
    const l = L() as { slides: Array<{ photo?: { use: string } }> };
    expect(dedupeBlogPhotos(l as never, 1)).toBe(1);
    expect(l.slides[3]!.photo!.use).toBe('blog');
  });
});

describe('realPhotoSlots — 표지 밖 실촬영 칸만 내용 대조(2026-10-15 사장님 "첫 장은 괜찮고 나머지는 내용 우선")', () => {
  it('표지는 빼고, 실촬영 블로그 사진 칸만 고른다', () => {
    const layout = { series: 's', slides: [
      { kind: 'cover', title: '표지', photo: { use: 'blog', n: 1 } },
      { kind: 'photo', title: '밑동', photo: { use: 'blog', n: 2 } },
      { kind: 'photo', title: '접목', photo: { use: 'blog', n: 3 } },
      { kind: 'photo', title: '새 사진', photo: { use: 'gen', scene: 'x' } },
    ] } as never;
    const blog = [{ n: 1, path: 'a', alt: '', real: true }, { n: 2, path: 'b', alt: '', real: true }, { n: 3, path: 'c', alt: '', real: false }];
    expect(realPhotoSlots(layout, blog)).toEqual([{ slide: 1, n: 2 }]);
  });
});

describe('칸 글 장 맞춤·뜻 대조 후보·pair 사진 형식 — 블루베리 겨울 카드 2026-11-03', () => {
  it('for(기획 제목)로 밀린 장을 제자리로, 제목을 조금 바꿔 적은 장은 제자리 유지', () => {
    const a = alignRawSlides([
      { for: '산길의 작은 감, 감나무일까요?', kind: 'cover' },
      { for: '산에 선 감나무는 큽니다', note: 'B' }, // 3번 장 내용이 2번 자리에
      { for: '세 군데로 알아봅니다', note: 'A' },
      { for: '이번 주말, 이 순서로!', kind: 'steps' }, // 문장부호만 다름
    ], PLAN.slides);
    expect(a.map((x) => x.note ?? x.kind)).toEqual(['cover', 'A', 'B', 'steps']);
  });
  it('for 가 절반 미만이면 순서대로', () => {
    const a = alignRawSlides([{}, { note: 'X' }, { note: 'Y' }, {}], PLAN.slides);
    expect(a.map((x) => x.note)).toEqual([undefined, 'X', 'Y', undefined]);
  });
  it('겹침 미달 칸은 rejected 에 모이고(제목+글·낱 글 모두), approved 면 살아난다', () => {
    const raw = { slides: [{}, { kind: 'points', items: [
      { title: '잎 테두리', text: '가장자리가 매끈해요' }, { title: '껍질', text: '흑회색, 잘게 갈라져요' },
    ] }, {}, {}] };
    const rejected = new Set<string>();
    expect(normalizeLayout(raw, PLAN, SRC, 0, undefined, { rejected }).slides[1]!.kind).toBe('photo');
    expect(rejected.has('가장자리가 매끈해요')).toBe(true);
    const l = normalizeLayout(raw, PLAN, SRC, 0, undefined, { approved: rejected });
    expect(l.slides[1]!.kind).toBe('points');
  });
  it('원문에 없는 수치가 든 칸은 뜻 대조 후보에도 올리지 않는다', () => {
    const rejected = new Set<string>();
    normalizeLayout({ slides: [{}, { kind: 'compare', bad: { label: '키', text: '20m까지 자라요' }, good: { label: '잎', text: '광택' } }, {}, {}] }, PLAN, SRC, 0, undefined, { rejected });
    expect([...rejected].some((t) => t.includes('20m'))).toBe(false);
  });
  it('pair 사진 자리를 한 겹 펴서 낸 응답도 받는다', () => {
    const l = normalizeLayout({ slides: [{}, { kind: 'pair',
      photos: [{ use: 'gen', photo: '손바닥 위 매끈한 감나무 잎 한 장', label: '잎' }, { use: 'blog', n: 1, label: '껍질' }],
      cards: [{ label: '잎', text: '톱니가 없고 광택이 나요' }, { label: '껍질', text: '흑회색, 잘게 갈라져요' }] }, {}, {}] }, PLAN, SRC, 1);
    expect(l.slides[1]!.kind).toBe('pair');
    expect(l.slides[1]!.photos?.[0]!.photo).toMatchObject({ use: 'gen', scene: '손바닥 위 매끈한 감나무 잎 한 장' });
  });
});
