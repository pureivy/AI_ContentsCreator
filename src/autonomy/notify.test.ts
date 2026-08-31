import { describe, it, expect } from 'vitest';
import { shouldRetryTelegram } from './notify';

// 실사고(2026-08-31): 사과나무묘목 쇼츠의 유튜브 업로드 완료 알림이 텔레그램으로 안 갔다.
// 로그: "[발행담당] … 유튜브 비공개 업로드 완료" 바로 다음 줄에 "[알림] 텔레그램 sendMessage 예외 —
// fetch failed". 업로드는 성공했고 알림만 네트워크 blip 한 번에 영구 소실됐다.
// 이 환경은 blip 이 잦다 — 같은 날 getUpdates 도 여러 번 "fetch failed" 후 복구됐다.
// 비대칭이 원인: 수신부(getUpdates)는 백오프·복구 루프가 있는데 송신부(sendMessage)는 1회 시도뿐이었다.
//
// 재시도는 '시간이 풀어 주는 실패'에만 한다. 토큰 폐기(401)·chat not found(400)·HTML 파싱 오류(400)는
// 몇 번을 보내도 같은 답이라, 재시도하면 실패를 늦게 알게 되고 API 만 두들긴다.
describe('shouldRetryTelegram — 전송 재시도 판정', () => {
  it('네트워크 예외는 재시도한다(fetch failed — 실제 사고 사유)', () => {
    expect(shouldRetryTelegram({ error: new TypeError('fetch failed') })).toBe(true);
  });

  it('타임아웃·연결 오류도 재시도한다', () => {
    expect(shouldRetryTelegram({ error: new Error('The operation was aborted due to timeout') })).toBe(true);
    expect(shouldRetryTelegram({ error: new Error('ECONNRESET') })).toBe(true);
  });

  it('429(혼잡)는 재시도한다', () => {
    expect(shouldRetryTelegram({ status: 429 })).toBe(true);
  });

  it('5xx(텔레그램 장애)는 재시도한다', () => {
    expect(shouldRetryTelegram({ status: 500 })).toBe(true);
    expect(shouldRetryTelegram({ status: 502 })).toBe(true);
  });

  it('401·403(토큰 문제)은 재시도하지 않는다 — 몇 번 보내도 같다', () => {
    expect(shouldRetryTelegram({ status: 401 })).toBe(false);
    expect(shouldRetryTelegram({ status: 403 })).toBe(false);
  });

  it('400(chat not found·HTML 파싱 오류)은 재시도하지 않는다', () => {
    expect(shouldRetryTelegram({ status: 400 })).toBe(false);
  });

  it('성공(2xx)은 재시도 대상이 아니다', () => {
    expect(shouldRetryTelegram({ status: 200 })).toBe(false);
  });

  it('아무 정보가 없으면 재시도하지 않는다(무한 루프 방어)', () => {
    expect(shouldRetryTelegram({})).toBe(false);
  });
});
