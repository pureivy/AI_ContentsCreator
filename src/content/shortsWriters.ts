/**
 * 숏폼 작가 3인 — 편마다 다른 작가가 쓰고, 작가마다 다른 목소리로 읽는다(2026-09-03).
 *
 * id 는 company.yaml 의 역할 id 와 같다. 오피스·직원 화면·티커가 전부 역할 로스터를 읽기 때문에,
 * 층위를 나누면(코드 페르소나 vs 역할) 새 작가가 어디에도 안 보인다(사용자 제보 2026-09-03).
 * 집필 규칙은 각 역할의 system_prompt 에 있고(같은 base + 각자 문체 블록), 이 파일은 그 역할이
 * 어떤 목소리로 읽히는지와 배정 규칙만 담는다.
 *
 * 왜: 148편이 전부 같은 작가(유하린)·같은 목소리(Jisoo)·같은 문체였다. 채널 지문의 큰 축이다.
 * 유튜브 대량생산 판정을 피하는 실질은 '결과물이 매번 다른 것'이고, 작가를 나누면 문체·훅·마무리와
 * 목소리가 한꺼번에 갈린다(목소리만 바꾸면 대본은 그대로라 절반만 갈린다).
 *
 * 목소리는 이 계정에 실재하는 일레븐랩스 한국어 보이스만 쓴다(2026-09-03 /v1/voices 조회 확인).
 * 다른 프로젝트에서 만든 개인 복제 보이스(대표님·원장님 등)는 쓰지 않는다.
 */

export interface ShortsWriter {
  id: string;
  /** 화면·기록에 노출되는 이름(people.yaml 의 shorts_writer 와 같은 층위). */
  name: string;
  /** 일레븐랩스 voice_id — 이 작가의 편은 이 목소리로 낭독된다. */
  voiceId: string;
  /** 참고용 보이스 설명(사람이 읽는 메모 — 코드 동작에는 영향 없음). */
  voiceNote: string;
  /**
   * 일레븐랩스 voice_settings — 작가별로 안정성·표현을 달리해 같은 문장도 다르게 읽히게 한다.
   * stability 낮을수록 표현 폭이 크고, 높을수록 또박또박해진다.
   */
  voiceSettings: { stability: number; similarity_boost: number; style?: number };
  /** 기획 프롬프트에 주입할 문체 지침 — 이게 대본을 실제로 가른다. */
  styleGuide: string;
}

export const SHORTS_WRITERS: readonly ShortsWriter[] = [
  {
    id: 'shorts_writer',
    name: '유하린',
    voiceId: 'iWLjl1zCuqXRkW6494ve',
    voiceNote: 'Jisoo — 여성·젊은 톤·또렷함(종전 전 편이 쓰던 목소리)',
    voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
    styleGuide: [
      '[작가: 유하린 — 실무 안내형]',
      '· 절차와 확인 순서로 말한다. "먼저 ~를 보고, 그다음 ~를 정해요" 같은 골격.',
      '· 문장은 짧고 단정하게. 군더더기 부사를 쓰지 않는다.',
      '· 숫자와 기준을 화면에 남긴다(며칠·몇 미터·몇 번).',
    ].join('\n'),
  },
  {
    id: 'shorts_writer_b',
    name: '임태윤',
    voiceId: 'm3gJBS8OofDJfycyA2Ip',
    voiceNote: 'Taehyung — 남성·젊은 톤·친근한 소셜 화법',
    voiceSettings: { stability: 0.35, similarity_boost: 0.7, style: 0.35 },
    styleGuide: [
      '[작가: 임태윤 — 대화형]',
      '· 듣는 사람에게 말을 건다. 묻고 바로 답하는 리듬으로 쓴다.',
      '· 종결을 "~죠", "~더라고요", "~거든요"로 섞는다. "~입니다"만 반복하지 않는다.',
      '· 흔한 오해를 먼저 집고("이거 추위 탓인 줄 알잖아요") 뒤집는다.',
    ].join('\n'),
  },
  // 곽재현(shorts_writer_c) 삭제 — 2026-09-09 사장님 확정 "임태윤·유하린만 쓴다". Jay Lee 도 Rosa Oh 도 마음에 안 들었다.
  // 레거시 11편의 writer/writerId 는 그대로 남고, 조회는 undefined → 전역 기본 목소리(유하린)로 떨어진다.
];

/** 초기 배정분(2026-09-03 오전)에 쓰던 임시 id — 역할 id 로 합치기 전 레코드 호환. */
const LEGACY_ID: Record<string, string> = {
  w_haerin: 'shorts_writer', w_taeyun: 'shorts_writer_b', w_jaehyun: 'shorts_writer_c',
};

export function writerById(id: string | undefined): ShortsWriter | undefined {
  if (!id) return undefined;
  const key = LEGACY_ID[id] ?? id;
  return SHORTS_WRITERS.find((w) => w.id === key);
}

/** 이름으로 조회(레거시 레코드는 writerId 없이 이름만 있다). */
export function writerByName(name: string | undefined): ShortsWriter | undefined {
  return SHORTS_WRITERS.find((w) => w.name === name);
}

/**
 * 채널별 최근 작가(2026-09-18). 종전엔 채널 구분 없이 최근 12편을 봐서, 한 글의 두 편이 같은 순간 파생되면
 * 항상 유튜브=임태윤·인스타=유하린으로 굳었다(실측 24편 12:12). 채널 안에서 번갈아야 한다는 사장님 요구.
 * shorts 는 최신순. 채널 미기록(레거시)은 '' 채널로 본다.
 */
export function recentWriterIdsFor(
  shorts: ReadonlyArray<{ platform?: string; writerId?: string }>, platform: string | undefined, limit = 12,
): Array<string | undefined> {
  return shorts.filter((s) => (s.platform ?? '') === (platform ?? '')).slice(0, limit).map((s) => s.writerId);
}

/**
 * 다음 편 작가 고르기(순수) — 최근 쓴 작가를 피한다. 최근 목록은 최신순.
 * 같은 작가가 연달아 나오지 않게 하는 게 목적이라 '가장 오래 안 쓴 작가'를 고른다.
 * 동률이면 목록 순서(안정) — 무작위를 쓰지 않는 이유는 재현성과 테스트 때문이다.
 */
export function pickWriter(recentWriterIds: ReadonlyArray<string | undefined>): ShortsWriter {
  let best = SHORTS_WRITERS[0]!;
  let bestAge = -1;
  for (const w of SHORTS_WRITERS) {
    const idx = recentWriterIds.findIndex((id) => id === w.id);
    const age = idx === -1 ? Number.MAX_SAFE_INTEGER : idx; // 안 나왔으면 가장 오래된 것으로
    if (age > bestAge) { bestAge = age; best = w; }
  }
  return best;
}
