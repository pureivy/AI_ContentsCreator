import { describe, it, expect } from 'vitest';
import {
  SHORTS_PLATFORMS, platformLabel, platformPlanGuide, autoDailyCapFor,
  canPublishTo, kstDate, youtubeUploadsToday, youtubeDailyCapBlock, platformQuotaCommitted, autoCapApplies, PLATFORM_QUOTA_AUTO_CUTOVER,
  pickTopicTarget, topicTargetBlock, topicPriorityBlock, demandGateForTarget,
  shouldStartSecondRun, SIBLING_PLAN_WAIT_MS } from './shortsPlatform';

describe('platformPlanGuide — 채널별로 다른 대본이 나오게 하는 지침(순수)', () => {
  it('유튜브·인스타 지침이 서로 다르다', () => {
    const yt = platformPlanGuide('youtube');
    const ig = platformPlanGuide('instagram');
    expect(yt).not.toBe(ig);
    expect(yt.length).toBeGreaterThan(50);
    expect(ig.length).toBeGreaterThan(50);
  });
  it('유튜브는 검색·완결을 지시하고 예고로 결론을 대체하지 말라고 못박는다', () => {
    const yt = platformPlanGuide('youtube');
    expect(yt).toContain('검색');
    expect(yt).toContain('다음 편');
  });
  it('인스타는 훅 길이와 판단 장면을 지시한다', () => {
    const ig = platformPlanGuide('instagram');
    expect(ig).toContain('24자');
    expect(ig).toContain('판단 장면');
  });
  it('인스타의 과녁은 저장이 아니라 공유다(2026-09-08 실측: 저장률은 히트를 못 가르고 공유가 가른다)', () => {
    const ig = platformPlanGuide('instagram');
    expect(ig).toContain('공유');
    expect(ig).toContain('받는 사람');
    expect(ig).not.toContain('저장하고 싶게');
  });
  it('레거시(미지정)는 빈 문자열 — 종전 동작 그대로', () => {
    expect(platformPlanGuide(undefined)).toBe('');
  });
});


describe('canPublishTo — 채널 발행 게이트(순수)', () => {
  it('자기 채널에만 올릴 수 있다', () => {
    expect(canPublishTo('youtube', 'youtube')).toBe(true);
    expect(canPublishTo('youtube', 'instagram')).toBe(false);
    expect(canPublishTo('instagram', 'instagram')).toBe(true);
    expect(canPublishTo('instagram', 'youtube')).toBe(false);
  });
  it('레거시(미지정)는 양쪽 허용 — 기존 108편의 재발행 경로를 막지 않는다', () => {
    expect(canPublishTo(undefined, 'youtube')).toBe(true);
    expect(canPublishTo(undefined, 'instagram')).toBe(true);
  });
});

describe('youtubeUploadsToday·youtubeDailyCapBlock — 하루 1편 상한(순수)', () => {
  // 2026-09-03 09:00 KST = 2026-09-03T00:00:00Z
  const now = Date.parse('2026-09-03T00:00:00Z');
  it('KST 날짜로 센다 — UTC 로 세면 저녁 업로드가 다음 날로 밀린다', () => {
    // 2026-09-02 20:03 KST = 2026-09-02T11:03Z
    expect(kstDate(Date.parse('2026-09-02T11:03:00Z'))).toBe('2026-09-02');
    // 2026-09-03 06:44 KST = 2026-09-02T21:44Z — UTC 로는 전날이지만 KST 로는 당일
    expect(kstDate(Date.parse('2026-09-02T21:44:00Z'))).toBe('2026-09-03');
  });
  it('오늘 업로드분만 센다', () => {
    const list = [
      { youtubeTs: '2026-09-02T21:44:00Z' }, // 09-03 06:44 KST — 오늘
      { youtubeTs: '2026-09-02T11:03:00Z' }, // 09-02 20:03 KST — 어제
      { youtubeTs: undefined },              // 미업로드
    ];
    expect(youtubeUploadsToday(list, now)).toBe(1);
  });
  it('상한에 닿으면 사유를 돌려준다', () => {
    const list = [{ youtubeTs: '2026-09-02T21:44:00Z' }];
    const msg = youtubeDailyCapBlock(list, now, 1);
    expect(msg).toContain('1/1편');
    expect(msg).toContain('2026-09-03');
  });
  it('상한 미달이면 null(통과)', () => {
    expect(youtubeDailyCapBlock([], now, 1)).toBeNull();
    expect(youtubeDailyCapBlock([{ youtubeTs: '2026-09-02T11:03:00Z' }], now, 1)).toBeNull();
  });
  it('cap 0 이하는 상한 없음 — 끄는 스위치', () => {
    const list = [{ youtubeTs: '2026-09-02T21:44:00Z' }, { youtubeTs: '2026-09-02T22:00:00Z' }];
    expect(youtubeDailyCapBlock(list, now, 0)).toBeNull();
    expect(youtubeDailyCapBlock(list, now, -1)).toBeNull();
  });
  it('깨진 타임스탬프는 세지 않는다', () => {
    expect(youtubeUploadsToday([{ youtubeTs: 'not-a-date' }], now)).toBe(0);
  });
});

describe('상수·표기', () => {
  it('채널은 유튜브·인스타 둘', () => { expect([...SHORTS_PLATFORMS]).toEqual(['youtube', 'instagram']); });
  it('사람이 읽는 이름', () => {
    expect(platformLabel('youtube')).toBe('유튜브');
    expect(platformLabel('instagram')).toBe('인스타');
    expect(platformLabel(undefined)).toBe('공용');
  });
});

describe('platformQuotaCommitted — 자율런 채널별 생성 상한(순수)', () => {
  const now = Date.parse('2026-09-03T00:00:00Z'); // 09-03 09:00 KST
  const yTs = '2026-09-02T21:44:00Z'; // 09-03 06:44 KST

  it('오늘 이미 유튜브에 올렸으면 유튜브 몫이 찼다', () => {
    expect(platformQuotaCommitted([{ youtubeTs: yTs }], now, 1, 'youtube')).toBe(true);
  });
  it('오늘 만든 미발행 편도 그 채널 몫을 잡는다 — 만들어 놓고 못 올리는 낭비 방지', () => {
    expect(platformQuotaCommitted([{ platform: 'youtube', stage: 'planning', createdTs: yTs, auto: true }], now, 1, 'youtube')).toBe(true);
  });
  it('인스타도 같은 상한을 받는다(2026-09-03 — 종전엔 유튜브만 막혔다)', () => {
    expect(platformQuotaCommitted([{ platform: 'instagram', stage: 'ready', createdTs: yTs, auto: true }], now, 1, 'instagram')).toBe(true);
  });
  it('채널이 다르면 서로 몫을 안 잡는다', () => {
    const list = [{ platform: 'instagram' as const, stage: 'ready', createdTs: yTs, auto: true }];
    expect(platformQuotaCommitted(list, now, 1, 'youtube')).toBe(false);
    expect(platformQuotaCommitted(list, now, 1, 'instagram')).toBe(true);
  });
  it('유튜브 업로드는 인스타 몫을 잡지 않는다', () => {
    expect(platformQuotaCommitted([{ youtubeTs: yTs }], now, 1, 'instagram')).toBe(false);
  });
  it('실패분은 몫을 잡지 않는다', () => {
    expect(platformQuotaCommitted([{ platform: 'youtube', stage: 'error', createdTs: yTs, auto: true }], now, 1, 'youtube')).toBe(false);
  });
  it('어제 것은 세지 않는다', () => {
    expect(platformQuotaCommitted([{ platform: 'youtube', stage: 'ready', createdTs: '2026-09-02T01:00:00Z', auto: true }], now, 1, 'youtube')).toBe(false);
  });
  it('숏폼 버튼으로 만든 편(auto 아님)은 오토런 몫을 안 먹는다 — 2026-10-02 모과나무 유튜브 편 누락(전환 뒤)', () => {
    const at = Date.parse('2026-10-03T03:00:00Z'); // 10-03 12:00 KST
    const ts = '2026-10-03T01:00:00Z';
    const manual = [{ platform: 'youtube' as const, stage: 'ready', createdTs: ts, auto: false }, { platform: 'youtube' as const, stage: 'ready', createdTs: ts }];
    expect(platformQuotaCommitted(manual, at, 1, 'youtube')).toBe(false);
    expect(platformQuotaCommitted([{ ...manual[0]!, auto: true }], at, 1, 'youtube')).toBe(true);
  });
  it('전환 전(10-03 00:00 KST 전)에 만든 편은 auto 표시와 무관하게 센다 — 그때는 오토런 세트 파생도 auto:false 였다', () => {
    expect(PLATFORM_QUOTA_AUTO_CUTOVER).toBe(Date.parse('2026-10-03T00:00:00+09:00'));
    const at = Date.parse('2026-10-02T12:00:00Z'); // 10-02 21:00 KST
    const old = [{ platform: 'youtube' as const, stage: 'ready', createdTs: '2026-10-02T01:00:00Z', auto: false }];
    expect(platformQuotaCommitted(old, at, 1, 'youtube')).toBe(true);
    expect(platformQuotaCommitted([{ platform: 'youtube' as const, stage: 'ready', createdTs: '2026-10-02T01:00:00Z' }], at, 1, 'youtube')).toBe(true);
    // 전환 직전·직후 경계 — 같은 KST 날(10-03)에 직전 편은 없다(직전은 10-02 KST), 직후 수동 편은 안 센다
    const after = Date.parse('2026-10-02T16:00:00Z');
    expect(platformQuotaCommitted([{ platform: 'youtube' as const, stage: 'ready', createdTs: '2026-10-02T15:00:00Z', auto: false }], after, 1, 'youtube')).toBe(false);
    expect(platformQuotaCommitted([{ platform: 'youtube' as const, stage: 'ready', createdTs: '2026-10-02T14:59:59Z', auto: false }], Date.parse('2026-10-02T14:59:59Z'), 1, 'youtube')).toBe(true);
  });
  it('업로드는 누가 만들었든 센다', () => {
    expect(platformQuotaCommitted([{ platform: 'youtube', stage: 'ready', createdTs: yTs, auto: false, youtubeTs: yTs }], now, 1, 'youtube')).toBe(true);
  });
  it('cap 0 이하는 상한 없음', () => {
    expect(platformQuotaCommitted([{ youtubeTs: yTs }], now, 0, 'youtube')).toBe(false);
  });
  it('상한 2 면 두 편까지', () => {
    const one = [{ platform: 'instagram' as const, stage: 'ready', createdTs: yTs, auto: true }];
    expect(platformQuotaCommitted(one, now, 2, 'instagram')).toBe(false);
    expect(platformQuotaCommitted([...one, ...one], now, 2, 'instagram')).toBe(true);
  });
});



describe('autoDailyCapFor — 채널별 자율런 상한', () => {
  const caps = { youtube: 1, instagram: 2 };
  it('채널마다 다른 값을 준다', () => {
    expect(autoDailyCapFor('youtube', caps)).toBe(1);
    expect(autoDailyCapFor('instagram', caps)).toBe(2);
  });
  it('레거시(채널 미지정)는 유튜브 값 — 보수적으로 조인다', () => {
    expect(autoDailyCapFor(undefined, caps)).toBe(1);
  });
  it('상한이 실제로 갈린다 — 인스타 1편 만든 뒤에도 인스타 몫이 남는다', () => {
    const now = Date.parse('2026-09-03T00:00:00Z');
    const made = [{ platform: 'instagram' as const, stage: 'ready', createdTs: '2026-09-02T21:44:00Z', auto: true }];
    expect(platformQuotaCommitted(made, now, autoDailyCapFor('instagram', caps), 'instagram')).toBe(false);
    // 같은 상황에서 유튜브 상한(1)이었다면 찼을 것
    expect(platformQuotaCommitted(made, now, autoDailyCapFor('youtube', caps), 'instagram')).toBe(true);
  });
});

describe('autoCapApplies — 상한을 걸 대상 판정(순수)', () => {
  it('스케줄러가 알아서 돈 글에는 건다', () => {
    expect(autoCapApplies({ auto: true })).toBe(true);
  });
  it('사용자가 주제를 넣어 돌린 글에는 안 건다', () => {
    expect(autoCapApplies({})).toBe(false);
    expect(autoCapApplies({ auto: false })).toBe(false);
  });
  it('사용자가 "오토런 지시"로 시작한 글에는 안 건다 — 손으로 시킨 일이다', () => {
    expect(autoCapApplies({ auto: true, userTriggered: true })).toBe(false);
  });
  it('출처를 모르면 건다 — 모르는 것을 무제한으로 열지 않는다', () => {
    expect(autoCapApplies(undefined)).toBe(true);
  });
  it('케이던스 기준선과 같은 기준을 쓴다 — auto && !userTriggered', () => {
    const cases = [
      { auto: true, userTriggered: false },
      { auto: true, userTriggered: true },
      { auto: false, userTriggered: false },
      { auto: false, userTriggered: true },
    ];
    // cadenceBaselineTs 는 `p.auto && !p.userTriggered` 인 것만 자율 생산분으로 센다.
    for (const c of cases) expect(autoCapApplies(c)).toBe(!!c.auto && !c.userTriggered);
  });
});

describe('pickTopicTarget — 오늘 자율 생산분의 채널 목표를 번갈아 고른다(순수)', () => {
  const now = Date.parse('2026-09-08T09:00:00Z'); // KST 09-08 18:00
  const today = '2026-09-08T00:30:00Z';           // KST 09-08 09:30
  const yesterday = '2026-09-07T10:00:00Z';       // KST 09-07 19:00
  it('오늘 아무것도 안 골랐으면 유튜브부터', () => {
    expect(pickTopicTarget([], now, 'b')).toBe('youtube');
  });
  it('오늘 유튜브 목표로 하나 골랐으면 다음은 인스타', () => {
    expect(pickTopicTarget([{ auto: true, shortsTarget: 'youtube', createdTs: today, brand: 'b' }], now, 'b')).toBe('instagram');
  });
  it('둘 다 하나씩이면 다시 유튜브(동률은 유튜브 먼저)', () => {
    expect(pickTopicTarget([
      { auto: true, shortsTarget: 'youtube', createdTs: today, brand: 'b' },
      { auto: true, shortsTarget: 'instagram', createdTs: today, brand: 'b' },
    ], now, 'b')).toBe('youtube');
  });
  it('어제 것·수동·사용자 촉발·다른 브랜드는 세지 않는다', () => {
    expect(pickTopicTarget([
      { auto: true, shortsTarget: 'youtube', createdTs: yesterday, brand: 'b' },
      { auto: false, shortsTarget: 'youtube', createdTs: today, brand: 'b' },
      { auto: true, userTriggered: true, shortsTarget: 'youtube', createdTs: today, brand: 'b' },
      { auto: true, shortsTarget: 'youtube', createdTs: today, brand: 'other' },
    ], now, 'b')).toBe('youtube');
  });
  it('목표 미기록 자율 편(예고·클러스터 경로)은 유튜브로 센다 — 아침에 예고를 갚은 날도 저녁은 인스타', () => {
    expect(pickTopicTarget([{ auto: true, createdTs: today, brand: 'b' }], now, 'b')).toBe('instagram');
  });
  it('상한이 아니라 편수로 번갈아야 한다 — 유튜브 상한을 올려도 인스타 목표 틱이 온다', () => {
    // 상한 기준이었다면 유튜브 상한 2 에서 1편 뒤에도 '유튜브 몫 남음'이라 인스타가 영영 안 온다.
    expect(pickTopicTarget([{ auto: true, shortsTarget: 'youtube', createdTs: today, brand: 'b' }], now, 'b')).toBe('instagram');
  });
});

describe('topicTargetBlock / topicPriorityBlock — 채널 목표별 주제 선정 지침(순수)', () => {
  it('인스타 목표는 축×제철에서 출발하고 검색량 하한을 걸지 않는다고 못박는다', () => {
    const b = topicTargetBlock('instagram');
    expect(b).toContain('인스타 소재 축 성적');
    expect(b).toContain('검색량 하한');
    expect(b).toContain('공유');
    expect(topicPriorityBlock('instagram')).toContain('[인스타 소재 축 성적] 상위 축 × 지금 절기');
  });
  it('유튜브 목표·미지정은 종전대로 검색 수요 표가 출발점 — 유튜브 목표 블록은 무주입(프롬프트가 종전과 같다)', () => {
    expect(topicTargetBlock('youtube')).toBe('');
    expect(topicPriorityBlock('youtube')).toBe(topicPriorityBlock(undefined));
    expect(topicPriorityBlock(undefined)).toContain('[검색 수요 실측] 표 — 여기서 먼저 고른다');
  });
  it('인스타 블록은 실제로 존재하는 블록 이름만 참조한다 — [제철 소재] 라는 블록은 없다', () => {
    expect(topicTargetBlock('instagram')).not.toContain('[제철 소재]');
    expect(topicPriorityBlock('instagram')).not.toContain('[제철 소재]');
    expect(topicTargetBlock('instagram')).toContain('[시기 밖 소재]');
  });
  it('두 채널의 우선순위 문구가 서로 다르다', () => {
    expect(topicPriorityBlock('instagram')).not.toBe(topicPriorityBlock('youtube'));
  });
});

describe('demandGateForTarget — 채널 목표별 검색 수요 게이트(순수)', () => {
  it('인스타 목표는 하한 미달을 통과시키고, 마지막 라운드 완화(relax)를 쓰지 않는다', () => {
    expect(demandGateForTarget('instagram', false)).toEqual({ relax: false, lowVolumePasses: true });
    expect(demandGateForTarget('instagram', true)).toEqual({ relax: false, lowVolumePasses: true });
  });
  it('유튜브·미지정은 종전 그대로 — 마지막 라운드에만 완화, 하한 미달은 기각', () => {
    expect(demandGateForTarget('youtube', false)).toEqual({ relax: false, lowVolumePasses: false });
    expect(demandGateForTarget('youtube', true)).toEqual({ relax: true, lowVolumePasses: false });
    expect(demandGateForTarget(undefined, true)).toEqual({ relax: true, lowVolumePasses: false });
  });
});

describe('shouldStartSecondRun — 두 번째 채널 런 출발 시점(순수, 2026-09-08 복원)', () => {
  it('형제 대본이 나오면 바로 출발한다 — 그게 기다린 이유다', () => {
    expect(shouldStartSecondRun({ siblingPlanExists: true, siblingStage: 'designing', waitedMs: 3_000 }))
      .toEqual({ start: true, reason: 'plan' });
  });
  it('대본 전이면 기다린다', () => {
    expect(shouldStartSecondRun({ siblingPlanExists: false, siblingStage: 'planning', waitedMs: 3_000 }))
      .toEqual({ start: false, reason: 'wait' });
  });
  it('형제가 실패하면 기다리지 않는다 — 영영 안 오는 대본을 기다리면 두 번째가 유실된다', () => {
    expect(shouldStartSecondRun({ siblingPlanExists: false, siblingStage: 'error', waitedMs: 3_000 }))
      .toEqual({ start: true, reason: 'sibling-error' });
  });
  it('상한을 넘으면 그냥 출발한다(fail-open)', () => {
    expect(shouldStartSecondRun({ siblingPlanExists: false, siblingStage: 'planning', waitedMs: SIBLING_PLAN_WAIT_MS }))
      .toEqual({ start: true, reason: 'timeout' });
  });
  it('대기 상한은 6분 — 기획 단계만 넘기면 된다', () => {
    expect(SIBLING_PLAN_WAIT_MS).toBe(360_000);
  });
});
