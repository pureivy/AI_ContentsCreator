import { describe, it, expect } from 'vitest';
import { naverBlogRef, lowTrafficSuspects, medianViews, LOW_TRAFFIC_DAYS, LOW_TRAFFIC_VIEWS, type TrafficRow, cohortMedians, COHORT_AGE_DAYS } from './naverIndexing';

// 네이버 블로그 URL 두 형식에서 blogId·postId 추출(2026-07-23 색인 점검) — 실측: 클린 형식과
// PostView.naver?blogId=&logNo= 편집기 형식이 섞여 있어 둘 다 처리해야 매칭이 된다.
describe('naverBlogRef — URL 형식별 blogId·postId 추출', () => {
  it('클린 형식 /blogId/postId', () => {
    expect(naverBlogRef('https://blog.naver.com/biondi_tree/224345904342')).toEqual({ blogId: 'biondi_tree', postId: '224345904342' });
  });
  it('PostView.naver?blogId=&logNo= 편집기 형식', () => {
    const u = 'https://blog.naver.com/PostView.naver?blogId=biondi_tree&Redirect=View&logNo=224347607380&categoryNo=1';
    expect(naverBlogRef(u)).toEqual({ blogId: 'biondi_tree', postId: '224347607380' });
  });
  it('빈/무관 URL 은 빈 문자열', () => {
    expect(naverBlogRef('')).toEqual({ blogId: '', postId: '' });
    expect(naverBlogRef('https://example.com/foo/123')).toEqual({ blogId: '', postId: '' });
  });
});

// 저품질 판정 근거 교체(2026-09-11 사용자 확정) — '자기 제목 검색에 없음'은 오탐이었다.
// 실측: 그 기준으로 잡힌 48편 중 47편이 네이버 조회가 잡혔고 중앙값 19회('있음' 글 11회보다 높음).
// 같은 제목으로 검색되는 글 수가 의심 346 vs 있음 8(43배) — 재던 것은 품질이 아니라 제목의 흔함이었다.
describe('lowTrafficSuspects — 유입으로 보는 저품질 의심', () => {
  const r = (title: string, ageDays: number, views: number | null): TrafficRow => ({ title, ageDays, views });
  it('발행 21일+ 이면서 조회 5회 미만만 잡고, 조회 적은 순으로 준다', () => {
    const rows = [r('가', 30, 1), r('나', 25, 4), r('다', 30, 5), r('라', 40, 60)];
    expect(lowTrafficSuspects(rows).map((x) => x.title)).toEqual(['가', '나']); // 5회는 미달 아님(경계 포함 안 함)
  });
  it('아직 안 지난 글은 유입이 없어도 판정하지 않는다 — 쌓이는 중이다', () => {
    expect(lowTrafficSuspects([r('신규', LOW_TRAFFIC_DAYS - 1, 0)])).toEqual([]);
    expect(lowTrafficSuspects([r('경계', LOW_TRAFFIC_DAYS, LOW_TRAFFIC_VIEWS - 1)]).length).toBe(1);
  });
  it("측정 기록이 없는 글(views null)은 '모름'이지 '없음'이 아니다 — 판정에서 뺀다", () => {
    expect(lowTrafficSuspects([r('미측정', 90, null)])).toEqual([]);
  });
  it('임계값을 바꿔 부를 수 있다', () => {
    const rows = [r('가', 30, 8), r('나', 30, 20)];
    expect(lowTrafficSuspects(rows, 30, 10).map((x) => x.title)).toEqual(['가']);
  });
});

describe('medianViews — 블로그 단위 낙차 확인용 중앙값', () => {
  const r = (views: number | null): TrafficRow => ({ title: 't', ageDays: 30, views });
  it('측정된 값만으로 중앙값 — 홀수·짝수·미측정 혼재', () => {
    expect(medianViews([r(1), r(5), r(9)])).toBe(5);
    expect(medianViews([r(2), r(4), r(6), r(8)])).toBe(4); // 짝수는 아래쪽
    expect(medianViews([r(3), r(null), r(9)])).toBe(3);
  });
  it('측정값이 하나도 없으면 null', () => {
    expect(medianViews([])).toBeNull();
    expect(medianViews([r(null)])).toBeNull();
  });
});

describe('cohortMedians — 같은 나이끼리 견주는 블로그 단위 낙차', () => {
  const r = (ageDays: number, viewsAtAge: number | null): TrafficRow => ({ title: 't', ageDays, views: 999, viewsAtAge });
  it('최근 발행분과 그 이전을 14일차 누적으로 나눠 중앙값을 낸다', () => {
    const rows = [r(20, 4), r(30, 10), r(50, 30), r(60, 40), r(70, 50)];
    expect(cohortMedians(rows)).toEqual({ recent: 4, older: 40, recentN: 2, olderN: 3 });
  });
  it('14일차가 안 된 글과 측정 못 한 글은 표본에서 빠진다', () => {
    const rows = [r(COHORT_AGE_DAYS - 1, 3), r(20, null), r(50, 10)];
    expect(cohortMedians(rows)).toEqual({ recent: null, older: 10, recentN: 0, olderN: 1 });
  });
  it('누적 조회(views)가 아무리 커도 판정에 안 쓴다 — 그게 거짓 경보의 원인이었다', () => {
    const rows = [{ title: 't', ageDays: 20, views: 5, viewsAtAge: 20 }, { title: 't', ageDays: 90, views: 500, viewsAtAge: 20 }];
    expect(cohortMedians(rows)).toEqual({ recent: 20, older: 20, recentN: 1, olderN: 1 });
  });
});
