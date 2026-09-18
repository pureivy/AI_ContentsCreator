/**
 * 인스타그램 장기 토큰 유지보수(2026-09-18).
 *
 * 실사고: 7월 중순에 연결한 60일 토큰이 9월 18일 새벽에 만료돼 릴스·카드뉴스 발행(code 190)과 성과 수집(insights 400)이
 * 통째로 끊겼고, 대시보드는 저장된 토큰이 있다는 이유로 '연결됨'을 보여 재연결 버튼조차 안 보였다. 만료된 토큰은
 * 갱신이 안 된다 — 재연결뿐. 그래서 만료 전에 코드가 돌려 놓는다.
 *
 * 규칙: 발급 24h 뒤부터 갱신 가능(ig_refresh_token, 60일 재발급). 7일마다 갱신 시도, 실패해도 다음 날 다시. 발급 시각을 모르는
 * 구 저장분은 오늘을 발급 시각으로 적고(stamp) 다음 주기에 갱신. 만료·무효(code 190)는 텔레그램으로 재연결 안내(하루 1회).
 */
import { getMetaAccount, setMetaToken, listMetaAccountSlugs, igTokenPlan, igTokenExpiresAt } from '../secrets/store';
import { notify } from '../autonomy/notify';

export const IG_GRAPH_HOST = 'https://graph.instagram.com';

export interface IgTokenCheck {
  slug: string;
  action: 'none' | 'stamped' | 'refreshed' | 'refresh-failed' | 'expired' | 'invalid' | 'no-ig';
  daysLeft?: number;
  detail?: string;
}

/** 토큰이 살아 있는가 — /me 호출 한 번. code 190 이면 무효(만료·비밀번호 변경·권한 회수). */
export async function probeIgToken(token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; code?: number; message: string }> {
  try {
    const r = await fetchImpl(`${IG_GRAPH_HOST}/me?fields=user_id&access_token=${encodeURIComponent(token)}`);
    const j = await r.json() as { user_id?: string; error?: { code?: number; message?: string } };
    if (r.ok && j.user_id) return { ok: true };
    return { ok: false, code: j.error?.code, message: j.error?.message ?? `HTTP ${r.status}` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

/** 장기 토큰 갱신 — 같은 계정의 새 60일 토큰. 발급 24h 이내·만료 뒤엔 실패한다(호출자가 판정). */
export async function refreshIgToken(token: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  try {
    const r = await fetchImpl(`${IG_GRAPH_HOST}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    const j = await r.json() as { access_token?: string; error?: { message?: string } };
    if (r.ok && j.access_token) return { ok: true, token: j.access_token };
    return { ok: false, message: j.error?.message ?? `HTTP ${r.status}` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}

const daysLeftOf = (ts: string | undefined, now: Date): number | undefined => {
  const exp = igTokenExpiresAt(ts);
  return exp ? Math.floor((exp.getTime() - now.getTime()) / 86_400_000) : undefined;
};

/** 브랜드 하나 점검·갱신(부수효과: 토큰 저장). 알림은 호출자(maintain)가 모아서 보낸다. */
export async function checkIgToken(slug: string, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<IgTokenCheck> {
  const a = getMetaAccount(slug);
  if (!a.igUserId || !a.pageAccessToken) return { slug, action: 'no-ig' };
  const plan = igTokenPlan(a.igTokenTs, now);
  if (plan === 'expired') return { slug, action: 'expired', daysLeft: daysLeftOf(a.igTokenTs, now) };
  if (plan === 'stamp') {
    // 발급 시각 미상 — 살아 있는지만 확인하고 오늘을 기준점으로 적는다(다음 주기에 갱신).
    const probe = await probeIgToken(a.pageAccessToken, fetchImpl);
    if (!probe.ok) return { slug, action: 'invalid', detail: probe.message };
    setMetaToken(slug, { igUserId: a.igUserId, pageAccessToken: a.pageAccessToken, igTokenTs: now.toISOString() });
    return { slug, action: 'stamped', daysLeft: daysLeftOf(now.toISOString(), now) };
  }
  if (plan === 'refresh') {
    const r = await refreshIgToken(a.pageAccessToken, fetchImpl);
    if (r.ok) {
      setMetaToken(slug, { igUserId: a.igUserId, pageAccessToken: r.token, igTokenTs: now.toISOString() });
      return { slug, action: 'refreshed', daysLeft: daysLeftOf(now.toISOString(), now) };
    }
    // 갱신 실패 — 토큰이 아직 살아 있으면 내일 다시, 죽었으면 재연결 안내.
    const probe = await probeIgToken(a.pageAccessToken, fetchImpl);
    if (!probe.ok) return { slug, action: 'invalid', detail: probe.message };
    return { slug, action: 'refresh-failed', daysLeft: daysLeftOf(a.igTokenTs, now), detail: r.message };
  }
  return { slug, action: 'none', daysLeft: daysLeftOf(a.igTokenTs, now) };
}

/** 알림이 필요한 결과인가(순수) — 만료·무효는 항상, 갱신 실패는 남은 날이 7일 이하일 때. */
export function igTokenNeedsAlert(c: IgTokenCheck): boolean {
  if (c.action === 'expired' || c.action === 'invalid') return true;
  if (c.action === 'refresh-failed') return (c.daysLeft ?? 99) <= 7;
  return false;
}

let lastAlertDay = '';
/** 일일 유지보수 — 모든 메타 연결 브랜드. perf-sync 잡에서 호출(fail-open). */
export async function maintainIgTokens(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<IgTokenCheck[]> {
  const out: IgTokenCheck[] = [];
  for (const slug of listMetaAccountSlugs()) {
    try {
      const c = await checkIgToken(slug, now, fetchImpl);
      out.push(c);
      const label = slug || '범용';
      if (c.action === 'refreshed') console.log(`[메타] 인스타 토큰 갱신 — ${label} (${c.daysLeft}일 남음)`);
      else if (c.action === 'stamped') console.log(`[메타] 인스타 토큰 발급 시각 기록 — ${label} (다음 갱신 7일 뒤)`);
      else if (c.action !== 'none' && c.action !== 'no-ig') console.log(`[메타] 인스타 토큰 ${c.action} — ${label}${c.daysLeft != null ? ` (${c.daysLeft}일)` : ''}${c.detail ? `: ${c.detail.slice(0, 100)}` : ''}`);
    } catch (e) { console.log(`[메타] 인스타 토큰 점검 실패(무해) — ${slug || '범용'}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const alerts = out.filter(igTokenNeedsAlert);
  const day = now.toISOString().slice(0, 10);
  if (alerts.length && lastAlertDay !== day) {
    lastAlertDay = day;
    const lines = alerts.map((c) => `· ${c.slug || '범용'}: ${c.action === 'expired' ? '만료됨' : c.action === 'invalid' ? '무효(만료·비밀번호 변경·권한 회수)' : `갱신 실패, ${c.daysLeft}일 남음`}`);
    void notify({ title: '⚠️ 인스타그램 재연결 필요', body: `${lines.join('\n')}\n대시보드 숏폼·카드뉴스 탭의 "🔄 인스타 재연결" 버튼으로 다시 연결해 주세요(Mac mini 브라우저에서). 그 전까지 릴스·카드뉴스 발행과 성과 수집이 멈춥니다.` }).catch(() => {});
  }
  return out;
}
