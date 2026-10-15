import { describe, it, expect, afterEach } from 'vitest';
import { inheritedClaims, formatInherited, salientTokens, writerSource } from './inheritedClaims';

// 고정 표본 — 실사고(piece_8d9113cdde 블로그 hold ↔ short_b894bf71fb 파생 pass)의 실제 문자열.
// 원문 게이트가 '근거 미확인'으로 분류한 손질 시기가 파생 숏폼 화면 목록에 그대로 떴다.
const CLAIM_회양목 = '회양목 - 겨울 잎 남습니다, 새순이 굳는 초여름에 한 번';
const CLAIM_향나무 = '향나무·측백류 - 겨울 잎 남습니다, 봄에 한 번, 늦여름에 한 번';
const CLAIM_질소 = '늦여름 이후에는 질소 성분이 많은 거름을 줄입니다.';

describe('inheritedClaims — 실사고 고정 표본', () => {
  it('재작성된 파생 문구에서도 같은 주장을 잡는다(복붙이 아니다)', () => {
    // 실측 유사도 38~56% — 문자열 포함 검사로는 절대 안 걸린다.
    const hits = inheritedClaims([CLAIM_회양목, CLAIM_향나무], [
      { field: '씬5 목록', text: '회양목: 초여름 한 번 / 쥐똥나무: 두 번 / 측백류: 봄·늦여름 두 번' },
    ]);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.field).toBe('씬5 목록');
    expect(hits[0]!.tokens).toEqual(expect.arrayContaining(['회양목', '초여름']));
  });

  it('원문 문장이 그대로 들어가도 잡는다', () => {
    expect(inheritedClaims([CLAIM_질소], [{ field: '캡션', text: '늦여름 이후에는 질소 거름을 줄이세요' }])).toHaveLength(1);
  });
});

describe('inheritedClaims — 과차단 방지', () => {
  const flagged = [CLAIM_회양목];
  // 토큰 1개만 겹치는 것은 '같은 주장'이 아니다 — 같은 나무의 다른 이야기까지 걸면 가드가 소음이 된다.
  it.each([
    ['같은 수종의 다른 이야기', '회양목은 낮은 경계에 잘 어울려요'],
    ['수종명만 언급', '회양목'],
    ['시기어만 겹침', '초여름에 물을 자주 줍니다'],
    ['완전 무관', '물은 흠뻑 주고 간격을 띄우세요'],
  ])('%s → 걸리지 않는다', (_label, text) => {
    expect(inheritedClaims(flagged, [{ field: 'X', text }])).toEqual([]);
  });

  it('빈 입력은 조용히 통과', () => {
    expect(inheritedClaims([], [{ field: 'X', text: '회양목 초여름 한 번' }])).toEqual([]);
    expect(inheritedClaims(flagged, [])).toEqual([]);
    expect(inheritedClaims(flagged, [{ field: 'X', text: '   ' }])).toEqual([]);
  });

  it('토큰이 빈약한 주장은 아무것과도 엮이지 않는다', () => {
    // "그렇습니다" 류가 남아 있으면 어떤 텍스트와도 우연히 걸린다 — MIN_SHARED 미만이면 건너뛴다.
    expect(inheritedClaims(['그렇습니다.'], [{ field: 'X', text: '회양목 초여름 한 번' }])).toEqual([]);
  });
});

describe('salientTokens', () => {
  it('조사를 떼어 같은 토큰으로 만든다', () => {
    const t = salientTokens('회양목은 초여름에 다듬어요');
    expect(t.has('회양목')).toBe(true);
    expect(t.has('초여름')).toBe(true);
  });

  it('변별력 없는 흔한 말은 토큰에서 뺀다 — 이게 없으면 무관한 주장이 "나무"로 엮인다', () => {
    const t = salientTokens('나무 가지 관리 방법');
    expect([...t]).toEqual([]);
  });
});

describe('상한·킬스위치', () => {
  afterEach(() => { delete process.env.INHERITED_CLAIMS; });

  it('결과 상한을 넘기지 않는다', () => {
    const many = Array.from({ length: 20 }, (_, i) => `회양목 초여름 항목${i}`);
    const fields = many.map((t, i) => ({ field: `씬${i}`, text: t }));
    expect(inheritedClaims([CLAIM_회양목], fields).length).toBeLessThanOrEqual(5);
  });

  it('INHERITED_CLAIMS=off 면 검사 자체가 멈춘다', () => {
    process.env.INHERITED_CLAIMS = 'off';
    expect(inheritedClaims([CLAIM_회양목], [{ field: 'X', text: '회양목: 초여름 한 번' }])).toEqual([]);
  });
});

describe('formatInherited', () => {
  it('필드·주장·근거 토큰을 한 줄로 낸다', () => {
    const [hit] = inheritedClaims([CLAIM_회양목], [{ field: '씬5 목록', text: '회양목: 초여름 한 번' }]);
    const line = formatInherited(hit!);
    expect(line).toContain('씬5 목록');
    expect(line).toContain('근거 미확인');
    expect(line).toContain('회양목');
  });

  it('긴 주장은 잘라 낸다(수정 라운드 입력이 비대해지지 않게)', () => {
    const long = `회양목 초여름 ${'가'.repeat(200)}`;
    const [hit] = inheritedClaims([long], [{ field: 'X', text: '회양목 초여름 한 번' }]);
    expect(formatInherited(hit!)).toContain('…');
  });
});

describe('writerSource — 작가가 받는 원문에서 근거 미확인 문장을 뺀다(2026-10-15)', () => {
  const body = [
    '**무화과는 겨울 최저 기온부터 봅니다.**',
    '',
    '## 겨울 기온',
    '영하 8도 아래가 해마다 몇 번씩 오는 곳이면 노지에 심어 두고 겨울을 넘기기는 어렵습니다. 그런 곳은 화분에 길러 겨울에 들입니다.',
    '- 영하 7도까지 내려가는 마당이면 무화과는 벽을 등진 자리에 두세요.',
    '- 바람이 덜 드는 남쪽 자리를 고릅니다.',
  ].join('\n');
  const flagged = [
    '영하 8도 아래가 해마다 몇 번씩 오는 곳이면 노지에 심어 두고 겨울을 넘기기는 어렵습니다.',
    '영하 7도까지 내려가는 마당이면 무화과는 벽을 등진 자리에 두세요.',
    '본문에 없는 문장입니다 그래서 못 찾습니다.',
  ];
  it('걸린 문장만 지우고 나머지·소제목·굵은 요약은 남긴다', () => {
    const r = writerSource(body, flagged, true);
    expect(r.removed).toBe(2);
    expect(r.body).not.toContain('영하 8도');
    expect(r.body).not.toContain('영하 7도');
    expect(r.body).toContain('## 겨울 기온');
    expect(r.body).toContain('그런 곳은 화분에 길러 겨울에 들입니다.');
    expect(r.body).toContain('- 바람이 덜 드는 남쪽 자리를 고릅니다.');
    expect(r.body).toContain('**무화과는 겨울 최저 기온부터 봅니다.**');
    expect(r.body).not.toMatch(/^-\s*$/m); // 빈 글머리 줄을 남기지 않는다
  });
  it('끄거나 목록이 비면 원문 그대로', () => {
    expect(writerSource(body, flagged, false)).toEqual({ body, removed: 0 });
    expect(writerSource(body, [], true)).toEqual({ body, removed: 0 });
  });
  it('소제목 줄은 걸려도 지우지 않는다', () => {
    const r = writerSource('## 겨울 기온\n본문입니다.', ['겨울 기온'], true);
    expect(r.body).toContain('## 겨울 기온');
  });
});

describe('writerSource — 실측에서 놓치던 모양(2026-10-15)', () => {
  it('두 문장짜리 주장(굵게로 감싼 인용)도 뺀다', () => {
    const body = '흔들어 보세요.\n**줄기만 흔들리고 흙이 그대로면 뿌리가 흙을 붙잡은 겁니다. 밑동 주변 흙까지 통째로 들썩거리면 아직 뿌리를 못 내렸어요.**\n\n봄에 심은 나무가 가을까지도 들썩거린다면 다시 봅니다.';
    const r = writerSource(body, ['줄기만 흔들리고 흙이 그대로면 뿌리가 흙을 붙잡은 겁니다. 밑동 주변 흙까지 통째로 들썩거리면 아직 뿌리를 못 내렸어요.'], true);
    expect(r.body).not.toContain('들썩거리면 아직');
    expect(r.body).not.toContain('**');
    expect(r.body).toContain('봄에 심은 나무가');
  });
  it('인용 표시(>, >>)와 문장 뒷부분만 걸린 경우 — 그 문장을 통째로 뺀다', () => {
    const body = '>> 전정은 자른 개수로 평가하지 않습니다. 이듬해 그 자리가 아물었는지로 평가합니다.\n폭이 중요한 까닭은, 줄기가 휘는 쪽으로 수관이 치우쳐 넓어지기 때문이에요.\n키만 재고 심으면 옆이 좁아집니다.';
    const r = writerSource(body, ['전정은 자른 개수로 평가하지 않습니다. 이듬해 그 자리가 아물었는지로 평가합니다.', '줄기가 휘는 쪽으로 수관이 치우쳐 넓어지기 때문이에요.'], true);
    expect(r.body).toBe('키만 재고 심으면 옆이 좁아집니다.');
    expect(r.removed).toBe(3);
  });
  it('굵은 머리말 뒤 같은 줄의 문장만 걸리면 머리말은 남긴다', () => {
    const r = writerSource('3) **도장지를 끊습니다.** 배나무는 이런 가지가 특히 많이 나옵니다.', ['배나무는 이런 가지가 특히 많이 나옵니다.'], true);
    expect(r.body).toBe('3) **도장지를 끊습니다.**');
  });
});

describe('inheritedClaims — 남은(근거 확인) 원문 문장이 더 잘 설명하면 승계가 아니다(2026-10-15)', () => {
  const body = [
    '노지에 심어 키우기 안전한 지대는 연평균 기온 14도 이상, 겨울 최저 극기온 영하 8도 이상인 곳입니다.',
    '영하 8도 아래가 해마다 몇 번씩 오는 곳이면 노지에 심어 두고 겨울을 넘기기는 어렵습니다.',
  ].join('\n');
  const flagged = ['영하 8도 아래가 해마다 몇 번씩 오는 곳이면 노지에 심어 두고 겨울을 넘기기는 어렵습니다.'];
  it('확인된 문장을 옮긴 대본은 잡지 않는다', () => {
    const f = [{ field: '씬3 내레이션', text: '노지에 심어도 되는 곳은 연평균 십사 도 이상, 겨울 최저 영하 팔 도 이상인 남부 지역이에요.' }];
    expect(inheritedClaims(flagged, f)).toHaveLength(1); // 원문 없이는 종전처럼 걸린다
    expect(inheritedClaims(flagged, f, 5, body)).toEqual([]);
  });
  it('여러 문장 설명란 — 확인된 문장이 함께 있어도 베낀 문장은 잡는다', () => {
    const f = [{ field: '설명', text: '노지에 심어도 되는 곳은 겨울 최저 영하 팔 도 이상인 남부예요. 영하 8도 아래가 해마다 몇 번씩 오면 노지에서 겨울나기 어려워요.' }];
    expect(inheritedClaims(flagged, f, 5, body)).toHaveLength(1);
  });
  it('이미지 표시 줄은 근거 문장으로 치지 않는다', () => {
    const b = `${body}\n[IMAGE: 오래된 배나무의 안쪽 가지가 겹친 장면]`;
    const fl = ['배나무는 이런 가지가 특히 많이 나옵니다. 굵고 곧아서 아까워 보이지만 꽃눈이 잘 안 앉고 안쪽 햇빛만 가립니다.'];
    expect(inheritedClaims(fl, [{ field: '씬2', text: '배나무 가지치기는 안쪽부터 봐요.' }], 5, b)).toHaveLength(1);
  });
  it('킬스위치 INHERITED_CLEAN_SOURCE=off 면 종전 판정', () => {
    process.env.INHERITED_CLEAN_SOURCE = 'off';
    try {
      expect(inheritedClaims(flagged, [{ field: '씬3', text: '노지에 심어도 되는 곳은 겨울 최저 영하 팔 도 이상인 남부 지역이에요.' }], 5, body)).toHaveLength(1);
    } finally { delete process.env.INHERITED_CLEAN_SOURCE; }
  });
  it('걸린 주장을 옮긴 대본은 여전히 잡는다', () => {
    const f = [{ field: '씬2 내레이션', text: '영하 팔 도 아래가 해마다 몇 번씩 오면 노지에서 겨울나기 어려워요.' }];
    expect(inheritedClaims(flagged, f, 5, body)).toHaveLength(1);
  });
});
