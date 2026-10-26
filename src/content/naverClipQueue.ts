/**
 * 네이버 클립 업로드 대기열(2026-10-02 사장님 요청) — 프로필이 바쁠 때 누른 업로드를 버리지 않고 기다렸다 올린다.
 *
 * 왜 필요한가. 클립 업로드·블로그 발행·네이버 성과 수집은 Chrome 프로필 하나를 같이 쓴다. 성과 탭의
 * '네이버 수집'(수 분~30분)이 돌던 18:41 에 사장님이 클립을 눌렀고, 서버는 "수집 진행 중"으로 거절했다 —
 * 화면엔 '업로드 실패'로만 보였다. 사람에게 30분 뒤 다시 누르라고 하는 대신, 누른 것을 기억해 두고
 * 프로필이 풀리면 서버가 이어서 올린다.
 *
 * 안전선:
 *  - 대기는 메모리에만 둔다. 서버가 재시작되면 대기는 사라지고(기록의 대기 표시는 부팅 때 지운다),
 *    몇 시간 뒤 사람이 모르는 사이에 공개 업로드가 나가는 일은 없다.
 *  - 너무 오래 기다린 건 버린다(MAX_WAIT_MS) — 새벽 수집에 밀려 아침에 갑자기 공개되는 것도 같은 이유로 막는다.
 *  - 실제 업로드는 같은 라우트를 다시 부른다 — 중복 공개 방지 검사(이미 올라감·등록 미확인)를 그대로 다시 받는다.
 * 여기는 순수 판정만 둔다(시각·바쁨을 인자로 받는다).
 */

export interface ClipQueueEntry {
  readonly id: string;
  readonly queuedAt: number;
  readonly force: boolean;
  /** 사실 검증 보류를 사람이 확인하고 누른 업로드(2026-10-26) — 대기 뒤 다시 보낼 때 빠지면 같은 라우트가 보류 409 로 되돌려 대기가 헛돈다. */
  readonly forceFact?: boolean;
}

/** 대기 상한 — 성과 수집 최장 실측(98건 ≈ 14분)과 UI 폴링 상한(45분)을 넉넉히 덮고, 반나절 묵히지는 않는다. */
export const CLIP_QUEUE_MAX_WAIT_MS = 2 * 60 * 60_000;

/** 이번 틱에 할 일(순수) — 오래된 것은 버리고, 프로필이 비었으면 가장 먼저 누른 하나를 꺼낸다. */
export function planClipQueue(
  queue: readonly ClipQueueEntry[], now: number, busy: boolean, maxWaitMs = CLIP_QUEUE_MAX_WAIT_MS,
): { expired: ClipQueueEntry[]; start?: ClipQueueEntry; rest: ClipQueueEntry[] } {
  const expired = queue.filter((e) => now - e.queuedAt > maxWaitMs);
  const live = queue.filter((e) => now - e.queuedAt <= maxWaitMs).slice().sort((a, b) => a.queuedAt - b.queuedAt);
  // 한 틱에 하나만 꺼낸다 — 꺼낸 업로드가 곧바로 프로필을 다시 잡으므로 나머지는 다음 틱에 본다.
  if (busy || !live.length) return { expired, rest: live };
  const [start, ...rest] = live;
  return { expired, start, rest };
}
