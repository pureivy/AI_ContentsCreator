/**
 * 숏폼 플랫폼 분리 — 유튜브 쇼츠와 인스타 릴스를 대본부터 따로 만들기 위한 순수 규칙.
 *
 * 왜: 2026-09-02 저녁부터 유튜브 신작 4편 연속 조회 0~5회(구작 꼬리·인스타는 정상). 같은 파일을
 * 양 채널에 그대로 올리고, 108편이 같은 템플릿·같은 훅 공식이었다. 유튜브 대량생산·비진정성 정책이
 * 예시로 드는 형태와 겹친다. 채널별로 다른 물건을 만들어 그 지문을 지운다(사용자 확정 2026-09-03).
 *
 * 두 채널은 소비 방식 자체가 다르다 — 이 파일의 지침은 전부 이 프로젝트 실측에 근거한다
 * (2026-09-08 재검증, docs/reports/2026-09-08-유튜브-1천-천장과-인스타-초기-저속-원인-분석.md):
 *  · 유튜브: 피드가 편마다 좁은 밴드(피드 유입 p50 960 · max 1,767)의 첫 배분을 주고 끝난다. 110편 중
 *    확대 배분 0. 배분량은 주제·시각·좋아요와 무관(축별 최종 924~1,142). 천장 밖으로 나가는 길은 검색뿐
 *    (제목이 실제 검색어일 때만). 시청 지속률 중앙 74%로 '보기 시작하면 끝까지 본다' — 완결성·검색어 적합이 레버다.
 *  · 인스타: 첫 6시간은 작은 시험 배분(~210회, 팔로워 수와 거의 무관)이고 6~12시간에 10~16%만 확대된다.
 *    확대를 가르는 신호는 **공유**뿐이다(공유 3회 이상: 히트 7/20 vs 비히트 1/92). 저장률·좋아요율은 히트를
 *    못 가른다(저장 0.30% vs 0.38%). 소재에 반응한다 — 제철 개화·수확 수종(배롱나무 중앙 2,757, 유실수 887)이
 *    기타 619 를 크게 앞선다. 화분·실내는 552 로 최하위.
 *
 * 채널별 편은 대본부터 따로 만든다(2026-09-08 사용자 확정, 비용 불문). 09-03~09-07 의 '형제편 자산 승계'는
 * 같은 대본·같은 이미지에 목소리만 달랐다 — 8쌍 전부 나레이션 5/5 씬 동일. 분리가 아니었다.
 * 되돌리려면 SHORTS_SIBLING_INHERIT=1.
 */

export type ShortsPlatform = 'youtube' | 'instagram';

export const SHORTS_PLATFORMS: readonly ShortsPlatform[] = ['youtube', 'instagram'] as const;

/** 사람이 읽는 이름(로그·알림). */
export function platformLabel(p: ShortsPlatform | undefined): string {
  return p === 'youtube' ? '유튜브' : p === 'instagram' ? '인스타' : '공용';
}

/**
 * 기획 프롬프트에 주입할 채널 지침(순수) — 같은 원문에서 서로 다른 대본이 나오게 하는 핵심.
 * 레거시(platform 미지정, 2026-09-03 이전 108편)는 빈 문자열 — 종전 동작 그대로.
 */
export function platformPlanGuide(platform: ShortsPlatform | undefined): string {
  if (platform === 'youtube') {
    return [
      '[채널: 유튜브 쇼츠] 이 대본은 유튜브 전용이다. 인스타용과 같은 구성을 쓰지 마라.',
      '· 검색해서 들어온 사람에게 답하는 글처럼 짜라. 제목은 사람들이 실제로 검색창에 치는 말에 가깝게(수종명+행동/시기).',
      '· 한 편에서 질문을 끝내라. "다음 편에 이어갈게요" 같은 예고로 결론을 대체하지 마라 — 마지막 씬은 판정 또는 행동 지시로 닫는다.',
      '· 첫 씬에서 무엇을 알려줄지 먼저 밝혀라(결론 예고). 궁금증만 걸고 미루지 마라.',
      '· 화면 텍스트는 소리 없이 봐도 뜻이 통하게. 자막이 곧 본문이다.',
    ].join('\n');
  }
  if (platform === 'instagram') {
    // 과녁은 '공유'다(2026-09-08 실측). 종전 지침은 '저장하고 싶게'였는데 저장률은 히트/비히트를
    // 못 갈랐다(0.30% vs 0.38%). 확대된 편은 공유가 있었다(공유 3회 이상: 히트 7/20 vs 비히트 1/92).
    // 공유는 "이거 너 얘기다" 하고 누군가에게 보내는 행동이라, 받는 사람이 정해지는 문장과
    // 한 줄로 전할 수 있는 판정이 있어야 일어난다.
    return [
      '[채널: 인스타 릴스] 이 대본은 인스타 전용이다. 유튜브용과 같은 구성을 쓰지 마라.',
      '· 검색이 아니라 스크롤 중에 걸리는 사람에게 말한다. 첫 문장은 24자 이내, 3초 안에 끝나게.',
      '· 목표는 저장이 아니라 공유다 — 보는 사람이 "이거 ○○한테 보내야겠다" 하게 만들어라.',
      '  (실측: 확대된 편은 공유가 있었고 저장·좋아요는 확대와 무관했다. 공유 3회 이상 히트 7/20 vs 비히트 1/92)',
      '· 받는 사람이 정해지는 문장을 하나 넣어라 — "마당에 배롱나무 있는 분", "올해 처음 가지치기 하는 분"처럼',
      '  특정 상황의 사람을 지목한다. 지금 이 주에 그 사람 마당에서 보이는 현상으로 시작하면 가장 강하다.',
      '· 손과 도구가 보이는 "판단 장면"을 중심에 둬라 — 어디를 자를지, 무엇을 남길지 같은 결정 순간.',
      '· 결론은 남에게 한 줄로 전할 수 있는 판정으로 — "지금 자르면 내년 꽃 없다"처럼 상황+행동+결과 한 문장.',
      '· 마지막은 예고가 아니라 그 한 줄 판정으로 닫는다. 순서·숫자 나열은 화면 텍스트로만 남긴다.',
    ].join('\n');
  }
  return '';
}

// platformSceneCount 폐기(2026-09-03) — 인스타를 한 씬 짧게 끊던 장치. 근거는 "채널별로 다른
// 영상이어야 중복으로 안 찍힌다"였는데 유튜브는 인스타를 볼 수 없어 그 전제가 성립하지 않았다.
// 게다가 대본을 공유하는 구조에서는 씬을 하나 빼는 안전한 방법이 없다 — 뒤에서 자르면 CTA 결론
// 카드가 날아가고, 본문에서 빼면 "질문 씬의 답은 다음 씬 첫 문장"이라는 자체 규칙이 깨진다.

/**
 * 이 숏폼을 해당 채널에 올릴 수 있는가(순수).
 * platform 미지정 = 레거시 레코드 → 양 채널 허용(기존 108편의 재발행·보강 경로를 막지 않는다).
 */
export function canPublishTo(shortPlatform: ShortsPlatform | undefined, target: ShortsPlatform): boolean {
  return !shortPlatform || shortPlatform === target;
}

/** KST 날짜(YYYY-MM-DD, 순수) — 하루 상한은 사용자 체감 기준인 한국 날짜로 센다. */
export function kstDate(ms: number): string {
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 오늘(KST) 이미 유튜브에 올라간 편수(순수). */
export function youtubeUploadsToday(
  uploads: ReadonlyArray<{ youtubeTs?: string }>, now: number,
): number {
  const today = kstDate(now);
  return uploads.filter((s) => {
    if (!s.youtubeTs) return false;
    const t = Date.parse(s.youtubeTs);
    return Number.isFinite(t) && kstDate(t) === today;
  }).length;
}

/**
 * 유튜브 하루 상한에 걸렸는가(순수) — 걸리면 사람이 읽을 사유, 아니면 null.
 * cap<=0 은 상한 없음(끄기)으로 본다.
 */
export function youtubeDailyCapBlock(
  uploads: ReadonlyArray<{ youtubeTs?: string }>, now: number, cap: number,
): string | null {
  if (cap <= 0) return null;
  const used = youtubeUploadsToday(uploads, now);
  if (used < cap) return null;
  return `오늘(${kstDate(now)}) 유튜브 업로드 ${used}/${cap}편 — 하루 상한에 걸렸습니다. 내일 올리거나 상한(YOUTUBE_DAILY_CAP)을 조정하세요.`;
}

/** 채널별 자율런 하루 상한 조회(순수) — 미지의 채널은 유튜브 값으로 본다(보수적). */
export function autoDailyCapFor(
  platform: ShortsPlatform | undefined, caps: { youtube: number; instagram: number },
): number {
  return platform === 'instagram' ? caps.instagram : caps.youtube;
}

/**
 * 이 글에서 나온 파생에 자율런 상한을 걸어야 하는가(순수).
 *
 * 상한은 "스케줄러가 알아서 돈 것"에만 건다(사용자 확정 2026-09-04). 사용자가 주제를 넣어
 * 직접 돌린 글도, 사용자가 "오토런 지시" 버튼을 눌러 시작한 글도 상한 밖이다 — 손으로 시킨
 * 일까지 막으면 도구가 아니라 방해가 된다.
 *
 * 종전엔 파생 시점(autoDeriveSet)이 이 구분을 안 봤다. 그래서 사용자가 직접 돌린 사계장미
 * 글의 숏폼이 그날 자율런이 채운 몫 때문에 통째로 누락됐다(실측 2026-09-04). 상한을 안 보는
 * 건 "숏폼 버튼을 직접 누른 경우"뿐이었다.
 *
 * 판정 기준은 케이던스 기준선(cadenceBaselineTs)과 같다 — `auto && !userTriggered`.
 * 두 곳이 다른 기준을 쓰면 "무엇이 자율 생산분인가"가 코드마다 달라진다.
 * 출처를 모르면 상한을 건다(보수적) — 모르는 것을 무제한으로 열어 두지 않는다.
 */
export function autoCapApplies(source: { auto?: boolean; userTriggered?: boolean } | undefined): boolean {
  if (!source) return true;
  return source.auto === true && source.userTriggered !== true;
}

/**
 * 오늘(KST) 이 채널의 자율런 몫이 이미 찼는가(순수) — '자동' 생성 게이트.
 *
 * 적용 범위가 중요하다. 이건 스케줄러가 알아서 도는 자율런에만 건다. 사용자가 직접 지시한 생성은
 * 상한을 보지 않는다(사용자 확정 2026-09-03) — 손으로 시킨 일까지 막으면 도구가 아니라 방해가 된다.
 * 코드로는 autoDeriveSet(자율)과 shortsFromPieceHandler(수동)가 갈라져 있고, 이 함수는 전자에서만 불린다.
 *
 * 발행만 막으면 하루 2~3편이 만들어지고 1편만 올라가 나머지는 버려진다(LLM·이미지 비용). 그래서
 * 파생 시점에도 같은 상한을 본다. '찼다'의 기준은 두 가지 합:
 *  · 오늘 이미 업로드된 편(유튜브는 youtubeTs, 인스타는 igReelId 보유분)
 *  · 오늘 만들어졌고 아직 안 올라간 그 채널 편(실패분 제외 — 실패는 몫을 잡지 않는다)
 */
export function platformQuotaCommitted(
  list: ReadonlyArray<{ platform?: ShortsPlatform; stage?: string; createdTs?: string; youtubeTs?: string; igReelId?: string }>,
  now: number, cap: number, platform: ShortsPlatform,
): boolean {
  if (cap <= 0) return false;
  const today = kstDate(now);
  const onToday = (ts: string | undefined): boolean => {
    if (!ts) return false;
    const t = Date.parse(ts);
    return Number.isFinite(t) && kstDate(t) === today;
  };
  const used = list.filter((s) => {
    if (platform === 'youtube' && onToday(s.youtubeTs)) return true; // 이미 올라감 — 업로드 자체가 몫
    if (s.platform !== platform || s.stage === 'error') return false;
    return onToday(s.createdTs);
  }).length;
  return used >= cap;
}

/** 두 번째 채널 런이 첫 채널 대본을 기다리는 상한 — 기획 단계(수 분)만 넘기면 된다. */
export const SIBLING_PLAN_WAIT_MS = 6 * 60_000;

/**
 * 두 번째 채널 런을 지금 출발시킬 것인가(순수) — 복원(2026-09-08). 09-03 에 승계 방식으로 바꾸며 지웠는데,
 * 승계를 끄고 독립 런으로 돌아오자 그때의 문제가 그대로 돌아온다: 동시에 띄우면 둘 다 서로를 못 봐서
 * 같은 원문에서 같은 축의 대본이 나온다(09-03 실측 '형제 대본 없음' 2건, 문체만 갈리고 알맹이가 같았다).
 * 목적은 '형제 대본을 보고 다른 각도를 고르게' 하는 것이므로 plan.json 이 생기면 바로 간다.
 * 형제가 실패(error)했거나 기다림이 상한을 넘으면 그냥 간다 — 기다리다 영영 안 만드는 쪽이 더 나쁘다.
 */
export function shouldStartSecondRun(
  a: { siblingPlanExists: boolean; siblingStage?: string; waitedMs: number; maxWaitMs?: number },
): { start: boolean; reason: 'plan' | 'sibling-error' | 'timeout' | 'wait' } {
  if (a.siblingPlanExists) return { start: true, reason: 'plan' };
  if (a.siblingStage === 'error') return { start: true, reason: 'sibling-error' };
  if (a.waitedMs >= (a.maxWaitMs ?? SIBLING_PLAN_WAIT_MS)) return { start: true, reason: 'timeout' };
  return { start: false, reason: 'wait' };
}

/**
 * 채널 목표별 검색 수요 게이트 처리(순수, 2026-09-08) — 인스타 목표는 하한 미달을 통과시키고,
 * 마지막 라운드의 '기아 방지' 완화(relax)도 쓰지 않는다. relax 가 켜지면 reject 가 demote(relaxed) 로
 * 바뀌어 통과 분기에 안 걸리고 후순위 보관함·유사 폴백 실격으로 흘러가, '하한을 걸지 않는다'가
 * 마지막 라운드에만 뒤집힌다(리뷰 2026-09-08). 유튜브·미지정은 종전 그대로.
 */
export function demandGateForTarget(
  target: ShortsPlatform | undefined, lastRound: boolean,
): { relax: boolean; lowVolumePasses: boolean } {
  const ig = target === 'instagram';
  return { relax: lastRound && !ig, lowVolumePasses: ig };
}

// ============================================================
// 채널 목표 주제 선정(2026-09-08 사용자 확정 "채널별로 따로, 비용 불문") — 주제 선정부터 갈라야
// 인스타의 4배 차이를 가져온다. 대본만 갈라서는 안 된다(유튜브 피드는 주제를 안 보고, 인스타는 본다).
//  · 유튜브 목표 틱: 종전대로 [검색 수요 실측] 표에서 출발(검색이 유일한 살아 있는 축).
//  · 인스타 목표 틱: [인스타 소재 축 성적] 상위 축 × 제철 소재에서 출발. 검색량 하한은 이 글에 걸지 않는다
//    (배롱나무는 월 검색 22 인데 인스타 중앙 2,757 — 검색량으로 조이면 인스타 히트가 태어나지 못한다).
// 파생은 그대로 양 채널이다(상한 안에서) — 유튜브 피드는 주제와 무관하게 ~1,000 을 주므로 인스타 주제
// 글의 유튜브편도 공짜 조회다. 목표는 '어느 채널을 보고 주제를 고르나'만 정한다.
// ============================================================

/**
 * 이번 틱의 채널 목표(순수) — 오늘(KST) 자율 생산분이 어느 채널 목표로 몇 편 나왔는지 세어 적은 쪽.
 * 동률이면 유튜브 먼저(아침 슬롯이 유튜브·저녁 슬롯이 인스타 — 인스타는 시간대 효과가 없어 어느 쪽이든 같다).
 * 상한이 아니라 편수로 번갈아야 한다 — 상한 기준이면 유튜브 상한을 2로 올리는 순간 인스타 목표 틱이 영영 안 온다.
 * 목표 미기록 자율 편(예고 이행·클러스터 형제 경로)은 **유튜브로 센다** — 검색어·예고 유래라 유튜브 성격이고,
 * 세지 않으면 아침 틱이 예고를 갚은 날 저녁 틱이 다시 유튜브가 되어 그날 인스타 목표 틱이 안 온다.
 * 사용자 촉발분(userTriggered)은 뺀다 — 케이던스와 같은 기준(사용자가 "지금 하나 더" 한 것이 번갈기를 밀면 안 된다).
 */
export function pickTopicTarget(
  pieces: ReadonlyArray<{ auto?: boolean; userTriggered?: boolean; shortsTarget?: ShortsPlatform; createdTs?: string; brand?: string }>,
  now: number, brand: string,
): ShortsPlatform {
  const today = kstDate(now);
  const count = { youtube: 0, instagram: 0 };
  for (const p of pieces) {
    if (!p.auto || p.userTriggered || (p.brand ?? '') !== brand) continue;
    const t = Date.parse(p.createdTs ?? '');
    if (!Number.isFinite(t) || kstDate(t) !== today) continue;
    count[p.shortsTarget ?? 'youtube'] += 1;
  }
  return count.instagram < count.youtube ? 'instagram' : 'youtube';
}

/**
 * 주제 제안 프롬프트에 넣을 채널 목표 블록(순수). 유튜브 목표는 종전 프롬프트가 이미 검색 우선이라
 * 짧게 못만 박고, 인스타 목표는 무엇을 보고 고를지 통째로 바꾼다.
 */
export function topicTargetBlock(target: ShortsPlatform): string {
  if (target === 'instagram') {
    return [
      '[채널 목표: 인스타 릴스] 이번 글의 숏폼은 인스타 릴스가 주 무대다. 인스타는 소재에 반응한다 —',
      '실측: 제철 개화·수확 수종 편(배롱나무 중앙 2,757회)이 기타 소재(619회)의 4배, 확대된 편은 전부 공유가 있었다.',
      '· 소재는 [인스타 소재 축 성적] 상위 축과 맨 위 오늘 날짜·절기에서 고른다([시기 밖 소재] 목록은 그대로 금지) —',
      '  지금 이 주에 마당에서 눈에 보이는 현상(꽃이 진다, 열매가 떨어진다, 잎끝이 마른다)과 "자를까 말까" 같은',
      '  판정이 걸린 소재가 가장 좋다.',
      '· 남에게 보내고 싶은 주제인가로 판단하라 — "마당에 ○○ 있는 사람"이 떠오르는 주제. 검색창에 치는 말인지는 둘째다.',
      '· 검색량 하한은 이 글엔 걸지 않는다(검색량이 작아도 기각되지 않는다). [검색 수요 실측] 표는 표기를 고를 때만 참고한다.',
      '· 화분·실내·베란다 소재는 피한다(실측 최하위 552회).',
    ].join('\n');
  }
  // 유튜브 목표는 무주입 — 종전 프롬프트가 이미 [검색 수요 실측] 표를 출발점으로 못박고 있어(topicPriorityBlock),
  // 같은 말을 한 번 더 넣으면 유튜브 틱의 프롬프트가 종전과 달라진다(회귀 대조 불가). 목표는 라벨(piece.shortsTarget)로만 남는다.
  return '';
}

/**
 * 신호 우선순위 선언(순수) — 채널 목표에 따라 '출발점'이 바뀐다. 종전 문구(유튜브·미지정)는 그대로다.
 * 인스타 목표는 2군을 '인스타 축 × 제철'로 바꾸고 검색 수요 표를 3군(보강)으로 내린다.
 */
export function topicPriorityBlock(target: ShortsPlatform | undefined): string {
  if (target === 'instagram') {
    return `[신호 우선순위 — 위 신호들이 충돌할 때] 1) **주제 축·수종 상한 도달(제안 금지)** · 계열 쿨다운 금지·리서치 실측 폐기·시기 밖 소재·기존 콘텐츠 유사 회피(금지) > 2) **[인스타 소재 축 성적] 상위 축 × 지금 절기(맨 위 날짜) — 여기서 먼저 고른다(선택의 출발점)** > 3) [검색 수요 실측] 표·리서치 기회·실검색 연관어(표기 보강) > 4) 성과 계열 확장(참고). 금지가 항상 이긴다. (검색량이 작다는 것은 이 글의 금지가 아니다.)\n`
      + `순서: 먼저 지금 절기에 마당에서 보이는 현상 중 [인스타 소재 축 성적] 상위 축으로 잡히는 소재를 고르고, 그다음 1군 금지에 걸리는지 확인해 걸리면 다음 소재로 내려가라. 검색량이 작아도 된다 — 이 글은 검색이 아니라 공유로 퍼지는 글이다.\n`
      + `상한 도달 축·수종은 아래 어떤 신호(시드·수요 표·연관어·성과 키워드)에 등장하더라도 후보로 내지 마라 — 코드가 기각해 그 자리가 통째로 버려진다. '아직 안 다룬 축'이 있으면 그 축에서 먼저 채워라.\n\n`;
  }
  return `[신호 우선순위 — 위 신호들이 충돌할 때] 1) **주제 축·수종 상한 도달(제안 금지)** · 계열 쿨다운 금지·실측 폐기·기존 콘텐츠 유사 회피(금지) > 2) **[검색 수요 실측] 표 — 여기서 먼저 고른다(선택의 출발점)** > 3) 리서치 기회·실검색 연관어(보강) > 4) 성과 계열 확장(참고). 금지가 항상 이긴다.\n`
    + `순서: 먼저 [검색 수요 실측] 표에서 지금 검색되는 키워드를 고르고, 그다음 1군 금지에 걸리는지 확인해 걸리면 표의 다음 행으로 내려가라. 상상으로 주제를 만든 뒤 수요를 맞춰 붙이지 마라 — 그렇게 나온 후보는 대부분 검색량 미달로 버려진다.\n`
    + `상한 도달 축·수종은 아래 어떤 신호(시드·수요 표·연관어·성과 키워드)에 등장하더라도 후보로 내지 마라 — 코드가 기각해 그 자리가 통째로 버려진다. '아직 안 다룬 축'이 있으면 그 축에서 먼저 채워라.\n\n`;
}
