import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aiCitationRowFrom, blogSearchRowFrom, missingSearchDates, isRepeatStatusRow, type BlogSearchRow } from './naverBlogKpi';

// 실측 응답(2026-10-02) — current-user 는 식별 키(baUserKey·idNo·naverId)를 뺀 부분만.
const fx = (name: string): unknown => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8'));
const TS = '2026-10-02T08:00:00.000Z';

describe('aiCitationRowFrom — AI 브리핑 인용수', () => {
  it('실측 current-user → 누적·이번 달 값', () => {
    expect(aiCitationRowFrom(fx('naver_current_user.json'), '2026-10-02', TS)).toEqual({
      date: '2026-10-02', ts: TS, status: 'ok', cumulative: 23908,
      currentMonth: 10, currentMonthCount: 449, selectionPeriodMonth: 8, selectionPeriodCount: 8123,
    });
  });
  it('인용수가 안 보이는 계정은 0 이 아니라 상태로', () => {
    const r = aiCitationRowFrom({ isSuccess: true, result: { loggedIn: true, mateCitations: null } }, '2026-10-02', TS);
    expect(r.status).toBe('not_visible');
    expect(r.cumulative).toBeUndefined();
    expect(aiCitationRowFrom({ result: { loggedIn: true, mateCitations: { currentMonthCount: 3 } } }, 'd', TS).status).toBe('not_visible');
  });
  it('세션 만료 → not_logged_in, 깨진 응답 → error', () => {
    expect(aiCitationRowFrom({ isSuccess: true, result: { loggedIn: false } }, 'd', TS).status).toBe('not_logged_in');
    for (const bad of [null, 'x', {}, { result: 5 }]) expect(aiCitationRowFrom(bad, 'd', TS).status).toBe('error');
  });
});

describe('blogSearchRowFrom — 블로그 전체 일별 검색어', () => {
  it("실측 10-01: 상위 20개 + '기타' 45 → 기타는 otherCv, 합은 refererTotalCount", () => {
    const r = blogSearchRowFrom(fx('naver_blog_referer_search.2026-10-01.json'), '2026-10-01', TS);
    expect(r.status).toBe('ok');
    expect(r.searchCv).toBe(71);
    expect(r.otherCv).toBe(45);
    expect(r.truncated).toBe(true);
    expect(r.queries).toHaveLength(20);
    expect(r.queries!.some((q) => q.query === '기타')).toBe(false);
    expect(r.queries![0]).toEqual({ query: '죽단화 묘목', cv: 3 });
    expect(r.queries!.reduce((n, q) => n + q.cv, 0) + 45).toBe(71);
  });
  it('statusCode 401 → not_logged_in, 400·깨진 응답 → error', () => {
    expect(blogSearchRowFrom({ statusCode: 401 }, 'd', TS).status).toBe('not_logged_in');
    expect(blogSearchRowFrom({ statusCode: 400, message: 'Internal service Error' }, 'd', TS).status).toBe('error');
    for (const bad of [null, 'x', 7]) expect(blogSearchRowFrom(bad, 'd', TS).status).toBe('error');
  });
  it('목록이 비었으면 ok + 빈 목록(검색 유입 없는 날)', () => {
    const r = blogSearchRowFrom({ statusCode: 200, result: { statDataList: [] } }, 'd', TS);
    expect(r).toMatchObject({ status: 'ok', searchCv: 0, queries: [] });
    expect(r.truncated).toBeUndefined();
  });
});

describe('missingSearchDates — ok 로 비어 있는 최근 날짜(어제까지)', () => {
  const now = new Date('2026-10-02T00:30:00Z'); // KST 10-02 09:30
  it('기록이 없으면 최근 7일(오래된 순)', () => {
    expect(missingSearchDates([], now)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
  });
  it('ok 행이 있는 날은 건너뛰고, 실패 행만 있는 날은 다시 묻는다', () => {
    const rows: BlogSearchRow[] = [
      { date: '2026-10-01', ts: TS, scope: 'blog', status: 'ok', queries: [] },
      { date: '2026-09-30', ts: TS, scope: 'blog', status: 'error' },
    ];
    expect(missingSearchDates(rows, now, 2)).toEqual(['2026-09-30']);
  });
});

describe('실패 상태 행은 같은 날·같은 상태로 한 번만(리뷰 2026-10-02 — 빠른 새로고침마다 쌓이던 것)', () => {
  it('isRepeatStatusRow — 같은 날짜·같은 실패 상태만 중복, 다른 날·다른 상태·ok 는 새 행', () => {
    const rows = [{ date: '2026-10-02', status: 'not_logged_in' as const }];
    expect(isRepeatStatusRow(rows, { date: '2026-10-02', status: 'not_logged_in' })).toBe(true);
    expect(isRepeatStatusRow(rows, { date: '2026-10-02', status: 'error' })).toBe(false);
    expect(isRepeatStatusRow(rows, { date: '2026-10-03', status: 'not_logged_in' })).toBe(false);
    expect(isRepeatStatusRow([{ date: '2026-10-02', status: 'ok' }], { date: '2026-10-02', status: 'ok' })).toBe(false);
  });

  describe('recordNaverBlogKpis — 반복 호출', () => {
    let tmp: string;
    let home: string | undefined;
    const H = { body: {} as unknown, calls: 0 };
    const rowsOf = (kind: string): Array<{ date: string; status: string }> => {
      const f = path.join(tmp, 'data', 'analytics', `${kind}-kpitest.jsonl`);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { date: string; status: string }) : [];
    };
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpi-'));
      home = process.env.HOME;
      process.env.HOME = tmp; // cookieFor 가 읽는 ~/.naver-blog-profiles 를 임시 홈으로
      H.calls = 0; H.body = { statusCode: 401 };
      vi.doMock('../config', () => ({ CONFIG: { dataDir: path.join(tmp, 'data') } }));
      vi.doMock('../util/fetch', () => ({
        fetchTimeout: async () => { H.calls++; return { status: 200, text: async () => JSON.stringify(H.body) }; },
      }));
      vi.resetModules();
    });
    afterEach(() => {
      if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
      vi.doUnmock('../config'); vi.doUnmock('../util/fetch'); vi.resetModules();
    });

    it('쿠키 없음 → 인용수 not_logged_in 행은 세 번 불러도 하나', async () => {
      const { recordNaverBlogKpis } = await import('./naverBlogKpi');
      const now = new Date('2026-10-02T03:00:00Z');
      for (let i = 0; i < 3; i++) expect((await recordNaverBlogKpis('kpitest', now)).ai).toBe('not_logged_in');
      expect(rowsOf('ai_citations')).toEqual([expect.objectContaining({ date: '2026-10-02', status: 'not_logged_in' })]);
      expect(H.calls).toBe(0);
      // 다음 날은 새 행(하루 한 줄은 남긴다)
      await recordNaverBlogKpis('kpitest', new Date('2026-10-03T03:00:00Z'));
      expect(rowsOf('ai_citations').map((r) => r.date)).toEqual(['2026-10-02', '2026-10-03']);
    });

    it('세션 만료(401) → 인용수·검색어 실패 행 각 하나, 매번 다시 묻고 회복되면 ok 를 적는다', async () => {
      const dir = path.join(tmp, '.naver-blog-profiles', 'kpitest');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'naver_cookies.json'), JSON.stringify([{ name: 'NID_AUT', value: 'x', domain: '.naver.com' }]), 'utf-8');
      const { recordNaverBlogKpis } = await import('./naverBlogKpi');
      const now = new Date('2026-10-02T03:00:00Z');
      H.body = { result: { loggedIn: false }, statusCode: 401 };
      for (let i = 0; i < 3; i++) await recordNaverBlogKpis('kpitest', now);
      expect(H.calls).toBe(6); // 인용수 1 + 검색어 1(실패에서 멈춤) × 3 — 회복 감지를 위해 묻기는 계속
      expect(rowsOf('ai_citations').map((r) => r.status)).toEqual(['not_logged_in']);
      expect(rowsOf('search_queries').map((r) => `${r.date}:${r.status}`)).toEqual(['2026-09-25:not_logged_in']);
      // 회복 — ok 는 그대로 적힌다
      H.body = { result: { loggedIn: true, mateCitations: { cumulativeCount: 5 } }, statusCode: 200 };
      expect((await recordNaverBlogKpis('kpitest', now)).ai).toBe('ok');
      expect(rowsOf('ai_citations').map((r) => r.status)).toEqual(['not_logged_in', 'ok']);
    });
  });
});
