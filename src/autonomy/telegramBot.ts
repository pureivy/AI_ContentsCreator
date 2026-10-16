/**
 * 텔레그램 봇 수신 폴러 — 검토 대기 알림의 발행 버튼(callback_query)과 수정요청 답장을 처리한다.
 * 서버에 공개 주소가 없으므로 웹훅 대신 getUpdates 롱폴링(50s). 액션은 자기 자신(127.0.0.1)의
 * HTTP 엔드포인트로 위임 — 라우트의 stage 가드·멱등(409)·in-flight 락을 그대로 재사용한다.
 *
 * 보안: TELEGRAM_CHAT_ID 와 일치하는 채팅의 업데이트만 처리(그 외 무시+오프셋 확인).
 * 부팅 이전 메시지는 조용히 드레인(오래된 '안녕' 류에 응답하지 않음). 실패는 전부 무해(다음 폴로 복구).
 * 주의: 폴러 가동 중 같은 토큰으로 수동 getUpdates 를 호출하면 409 충돌이 난다(진단 시 폴러 먼저 내릴 것).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CONFIG } from '../config';
import { getSecret } from '../secrets/store';
import { telegramCreds, tgApiUrl, sendTelegramHtml, sendTelegramPhotos, type TgButton } from './notify';
import { studioBase, escapeHtml, naverPublishLabel } from './contentNotify';

export type BotAction =
  | { kind: 'naver_draft'; id: string }
  | { kind: 'revise'; id: string }
  | { kind: 'cardnews_publish'; id: string }
  | { kind: 'cardnews_force'; id: string }
  | { kind: 'shorts_youtube'; id: string }
  | { kind: 'shorts_meta'; id: string }
  // 썸네일 한글 QA 미해결(2026-09-16 사용자 요청) — 카드뉴스와 같은 '확인 후 강행' 2단계를 숏폼에도.
  // 종전엔 업로드 버튼이 409 로 막히기만 하고 앞으로 갈 길이 없었다(수정요청은 대본만 고쳐 표식이 그대로 남는다).
  | { kind: 'shorts_youtube_force'; id: string }
  | { kind: 'shorts_meta_force'; id: string }
  // 네이버 클립(2026-10-02) — 유튜브용 편을 클립에도. 강행(nf)은 썸네일 QA 확인 뒤.
  | { kind: 'shorts_clip'; id: string }
  | { kind: 'shorts_clip_force'; id: string }
  | { kind: 'shorts_clip_check'; id: string }
  | { kind: 'shorts_thumb_regen'; id: string }
  // 사실 검증 보류 확인 후 강행(2026-10-12 사장님 확정) — 근거 없는 문장을 보여 준 뒤 한 번 더 받는다(yh·mh·nh).
  | { kind: 'shorts_fact_force'; id: string; ch: 'youtube' | 'instagram' | 'clip' };

/**
 * 자율런 지시 명령(순수, 2026-09-10) — "자율런 지시: …" 로 설정, "지시 끄기/켜기/상태/삭제". 아니면 null.
 * '지시 N편: …' 꼴은 편수 상한을 함께 받는다.
 */
export type DirectiveCommand =
  | { kind: 'set'; text: string; maxPieces?: number }
  | { kind: 'off' } | { kind: 'on' } | { kind: 'show' } | { kind: 'clear' };
export function parseDirectiveCommand(text: string): DirectiveCommand | null {
  const t = text.trim();
  const m = /^(?:자율런|오토런)?\s*지시\s*(?:(\d{1,2})\s*편)?\s*[:：]\s*([\s\S]+)$/.exec(t);
  if (m && m[2]!.trim()) {
    const n = m[1] ? Number(m[1]) : undefined;
    return { kind: 'set', text: m[2]!.trim(), ...(n && n > 0 ? { maxPieces: n } : {}) };
  }
  const w = /^(?:자율런|오토런)?\s*지시\s*(끄기|해제|중지|off|켜기|재개|on|상태|확인|삭제|지우기)?\s*$/i.exec(t);
  if (!w) return null;
  const op = (w[1] ?? '상태').toLowerCase();
  if (['끄기', '해제', '중지', 'off'].includes(op)) return { kind: 'off' };
  if (['켜기', '재개', 'on'].includes(op)) return { kind: 'on' };
  if (['삭제', '지우기'].includes(op)) return { kind: 'clear' };
  return { kind: 'show' };
}
/** 지시 상태 한 줄(순수) — 텔레그램 답장용. */
export function describeDirective(d: { text: string; on: boolean; made: number; maxPieces?: number; lastResult?: string } | null): string {
  if (!d) return '자율런 지시 없음 — 기존 자율런으로 돕니다.\n설정: "자율런 지시: 보관소의 수종별 수확 후 전정" (편수 상한은 "지시 5편: …")';
  const q = d.maxPieces ? `${d.made}/${d.maxPieces}편` : `${d.made}편`;
  // 켜진 채 소진 보류 중이면(2026-09-18) 그 사유도 보인다 — 왜 생산이 쉬는지 상태 한 줄로 알 수 있게.
  const why = d.lastResult ? `\n사유: ${d.lastResult}` : '';
  return `${d.on ? '🟢 지시 켜짐' : '⚪ 지시 꺼짐'} — "${d.text}" (${q})${!d.on ? why : (d.lastResult?.startsWith('소진 보류') ? why : '')}${d.on ? '' : '\n다시 켜기: "지시 켜기"'}`;
}

/** 콜백 데이터 파싱(≤64바이트 규격: "<op>:<id>"). 불명이면 null. 순수 — 테스트 대상. */
export function parseCallback(data: string): BotAction | null {
  const m = /^(bp|rv|cp|cf|sy|sm|yf|mf|tr|nc|nf|nk|yh|mh|nh):([A-Za-z0-9_]{1,48})$/.exec(data);
  if (!m) return null;
  const id = m[2]!;
  switch (m[1]) {
    case 'bp': return { kind: 'naver_draft', id };
    case 'rv': return { kind: 'revise', id };
    case 'cp': return { kind: 'cardnews_publish', id };
    case 'cf': return { kind: 'cardnews_force', id };
    case 'sy': return { kind: 'shorts_youtube', id };
    case 'sm': return { kind: 'shorts_meta', id };
    case 'yf': return { kind: 'shorts_youtube_force', id };
    case 'mf': return { kind: 'shorts_meta_force', id };
    case 'tr': return { kind: 'shorts_thumb_regen', id };
    case 'nc': return { kind: 'shorts_clip', id };
    case 'nf': return { kind: 'shorts_clip_force', id };
    case 'nk': return { kind: 'shorts_clip_check', id };
    case 'yh': return { kind: 'shorts_fact_force', id, ch: 'youtube' };
    case 'mh': return { kind: 'shorts_fact_force', id, ch: 'instagram' };
    case 'nh': return { kind: 'shorts_fact_force', id, ch: 'clip' };
    default: return null;
  }
}

/** 수정요청 답장의 대상 라우트(순수, 테스트 대상) — 파생(card_/short_)은 자기 revise 라우트(수 분 동기),
 *  그 외는 블로그 piece revise(리비전 런 발사). rv 버튼이 세 종류 알림에 다 달리면서 필요해졌다. */
export function reviseEndpointFor(id: string): { path: string; label: string; derived: boolean } {
  if (id.startsWith('card_')) return { path: `/cardnews/${id}/revise`, label: '카드뉴스', derived: true };
  if (id.startsWith('short_')) return { path: `/shorts/${id}/revise`, label: '숏폼', derived: true };
  return { path: `/pieces/${id}/revise`, label: '블로그', derived: false };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 자기 서버 호출 — 라우트 가드·멱등을 재사용. AUTH_TOKEN 설정 시 Bearer 동봉. */
async function api(pathname: string, body?: unknown, timeoutMs = 600_000): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = (getSecret('AUTH_TOKEN') || '').trim();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(`http://127.0.0.1:${CONFIG.port}${pathname}`, {
    method: 'POST', headers, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs),
  });
  let json: Record<string, unknown> | null = null;
  try { json = await r.json() as Record<string, unknown>; } catch { /* 비 JSON 응답 — 상태코드로만 판정 */ }
  return { ok: r.ok, status: r.status, json };
}

/** 긴 동기 라우트(카드뉴스·숏폼 수정 요청) 전용 자기 서버 호출 — fetch(undici)는 응답 머리를 5분(headersTimeout 기본값)
 *  넘게 못 기다려 'fetch failed' 로 끊는다. 수정 재조립에 모션그래픽까지 붙으면서 10~30분이 걸려, 서버는 계속 만드는데
 *  텔레그램엔 '수정 요청 실패'가 먼저 갔다(2026-10-17 사장님 제보). node:http 는 그런 기본 제한이 없어 우리 timeoutMs 만 쓴다. */
function apiLong(pathname: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const payload = JSON.stringify(body ?? {});
  const headers: Record<string, string | number> = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  const tok = (getSecret('AUTH_TOKEN') || '').trim();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: CONFIG.port, path: pathname, method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => {
        clearTimeout(timer);
        let json: Record<string, unknown> | null = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>; } catch { /* 비 JSON 응답 — 상태코드로만 판정 */ }
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => req.destroy(new Error(`${Math.round(timeoutMs / 60_000)}분 안에 끝나지 않음`)), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(payload);
  });
}
/** 수정 요청 대기 한도 — 재조립 + 모션그래픽(에이전트 60분·검사 10분·렌더 20분)을 다 덮는다. */
const DERIVED_REVISE_TIMEOUT_MS = 120 * 60_000;

// 오류 본문은 업스트림(구글·그래프 API) 문자열이 섞일 수 있어 이스케이프 필수 — 안 하면 parse_mode HTML 이
// 거부해 실패 메시지조차 사용자에게 못 간다(이중 침묵).
const errText = (label: string, r: { status: number; json: Record<string, unknown> | null }): string =>
  `⚠️ ${label} — ${escapeHtml(typeof r.json?.error === 'string' ? r.json.error : `HTTP ${r.status}`)}`;

/** 버튼 액션 실행 → 사용자에게 보낼 결과 문구. revise 는 답장 유도라 여기 없음. */
/** 액션 실행기가 쓰는 HTTP 호출 — 테스트가 갈아끼울 수 있게 인자로 뺀다(이 파일의 순수/부수 분리). */
export type ApiCall = (pathname: string, body?: unknown, timeoutMs?: number) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }>;
/** 사용자에게 직접 보내는 통로(사진·본문) — 테스트가 갈아끼울 수 있게 인자로 뺀다(ApiCall 과 같은 사상). */
export interface Senders { photos: typeof sendTelegramPhotos; html: typeof sendTelegramHtml }
const REAL_SENDERS: Senders = { photos: sendTelegramPhotos, html: sendTelegramHtml };

// 유튜브 업로드 완료 문구 — 공개 발행(2026-10-01, 라우트의 public_pending)이면 자동 공개 예정, 아니면 종전 비공개 안내.
// 바로 공개(public_direct, 2026-10-05)는 이미 공개 — '공개 예정'·'비공개'로 쓰면 사람이 스튜디오에서 또 손댄다.
const ytDoneText = (j: Record<string, unknown> | null): string =>
  (j?.public_direct === true ? '▶️ 유튜브 공개 업로드 완료 — 이미 공개됨(커버 확인 중)'
    : j?.public_pending === true ? '▶️ 유튜브 업로드 완료 — 자동 공개 예정' : '▶️ 유튜브 비공개 업로드 완료');
const ytDoneTail = (j: Record<string, unknown> | null): string =>
  (j?.public_direct === true ? '\n커버가 첫 장면이 아니면 따로 알려 드립니다.'
    : j?.public_pending === true ? '\n썸네일까지 확인하고, 안 뜨면 따로 알려 드립니다.' : '\n공개 전환은 유튜브 스튜디오에서.');

export async function runAction(a: Exclude<BotAction, { kind: 'revise' }>, call: ApiCall = api, send: Senders = REAL_SENDERS): Promise<string> {
  switch (a.kind) {
    case 'naver_draft': {
      const r = await call(`/pieces/${a.id}/naver-draft`, { actor: '텔레그램' }, 30_000);
      return r.ok ? `📗 ${naverPublishLabel()} 시작 — 완료되면 알림이 옵니다.` : errText(`${naverPublishLabel()} 시작 실패`, r);
    }
    case 'cardnews_publish': {
      const r = await call(`/cardnews/${a.id}/publish`);
      if (!r.ok) {
        // 오타 QA 미해결 게이트(409) — 실패로 끝내지 않고 '확인 후 강행' 2단계로 잇는다:
        // 의심 슬라이드 이미지를 보내 사용자가 텔레그램에서 바로 검수하고, 이상 없으면 강행(cf) 버튼.
        const qa = Array.isArray(r.json?.qa_unresolved) ? (r.json!.qa_unresolved as unknown[]).filter((n): n is number => typeof n === 'number') : [];
        if (r.status === 409 && qa.length) {
          const dir = path.join(CONFIG.dataDir, 'cardnews', a.id);
          const flagged = qa.map((n) => path.join(dir, `slide_${String(n).padStart(2, '0')}.png`)).filter((p) => fs.existsSync(p));
          if (flagged.length) await sendTelegramPhotos(flagged, `⚠️ 오타 의심 슬라이드 ${qa.join(', ')}`);
          await sendTelegramHtml(
            `⚠️ 오타 QA 미해결 — 슬라이드 ${qa.join(', ')} 확인 필요\n위 이미지 문구가 정상이면 아래 버튼으로 발행을 강행하세요. 오타가 보이면 스튜디오에서 수정 후 발행하세요.\n${studioBase()}/`,
            [[{ text: `✅ 확인했어요 — 강행 발행`, callback_data: `cf:${a.id}` }]],
          );
          return ''; // 안내는 위에서 이미 전송 — 호출부가 빈 문자열은 재전송하지 않는다.
        }
        return errText('카드뉴스 발행 실패', r);
      }
      const link = typeof r.json?.igPermalink === 'string' ? `\n${r.json.igPermalink}` : '';
      const fbErr = typeof r.json?.fbError === 'string' && r.json.fbError ? `\n(페북: ${r.json.fbError})` : '';
      return `📸 인스타 캐러셀 발행 완료${link}${fbErr}`;
    }
    case 'cardnews_force': {
      // 사용자가 의심 슬라이드를 확인한 뒤의 강행 발행 — 라우트의 force 게이트(qaPublishBlockReason)를 통과.
      const r = await call(`/cardnews/${a.id}/publish`, { force: true });
      if (!r.ok) return errText('카드뉴스 강행 발행 실패', r);
      const link = typeof r.json?.igPermalink === 'string' ? `\n${r.json.igPermalink}` : '';
      const fbErr = typeof r.json?.fbError === 'string' && r.json.fbError ? `\n(페북: ${r.json.fbError})` : '';
      return `📸 인스타 캐러셀 발행 완료(QA 확인 강행)${link}${fbErr}`;
    }
    case 'shorts_youtube': {
      const r = await call(`/shorts/${a.id}/youtube`);
      if (!r.ok) {
        if (await sendThumbQaGuide(r, a.id, 'youtube', send)) return '';
        if (await sendFactHoldGuide(r, a.id, 'youtube', send)) return '';
        return errText('유튜브 업로드 실패', r);
      }
      // 라우트가 이미 완료 알림(📺)을 보냈으면 여기선 아무것도 안 보낸다 — 안 그러면 같은 말이
      // 두 통 온다(실사고 2026-09-08). '액션이 직접 전송한 경우 빈 문자열' 규칙(아래 호출부)을 따른다.
      if (r.json?.notified === true) return '';
      const url = typeof r.json?.url === 'string' ? r.json.url : typeof r.json?.youtubeUrl === 'string' ? r.json.youtubeUrl : '';
      return `${ytDoneText(r.json)}${url ? `\n${url}` : ''}${ytDoneTail(r.json)}`;
    }
    case 'shorts_meta': {
      const r = await call(`/shorts/${a.id}/meta`);
      if (!r.ok) {
        if (await sendThumbQaGuide(r, a.id, 'instagram', send)) return '';
        if (await sendFactHoldGuide(r, a.id, 'instagram', send)) return '';
        return errText('릴스 발행 실패', r);
      }
      const link = typeof r.json?.igPermalink === 'string' ? `\n${r.json.igPermalink}` : '';
      return `🎬 인스타 릴스 발행 완료${link}`;
    }
    case 'shorts_youtube_force': {
      // 사용자가 썸네일을 눈으로 확인한 뒤의 강행 업로드 — 라우트의 force 게이트를 통과한다.
      const r = await call(`/shorts/${a.id}/youtube`, { force: true });
      if (!r.ok) {
        if (await sendFactHoldGuide(r, a.id, 'youtube', send)) return ''; // 썸네일은 확인됐고 사실 검증 보류가 남은 경우
        return errText('유튜브 강행 업로드 실패', r);
      }
      if (r.json?.notified === true) return '';
      const url = typeof r.json?.url === 'string' ? r.json.url : typeof r.json?.youtubeUrl === 'string' ? r.json.youtubeUrl : '';
      return `${ytDoneText(r.json)}(썸네일 확인 강행)${url ? `\n${url}` : ''}${ytDoneTail(r.json)}`;
    }
    case 'shorts_meta_force': {
      const r = await call(`/shorts/${a.id}/meta`, { force: true });
      if (!r.ok) {
        if (await sendFactHoldGuide(r, a.id, 'instagram', send)) return '';
        return errText('릴스 강행 발행 실패', r);
      }
      const link = typeof r.json?.igPermalink === 'string' ? `\n${r.json.igPermalink}` : '';
      return `🎬 인스타 릴스 발행 완료(썸네일 확인 강행)${link}`;
    }
    case 'shorts_clip':
    case 'shorts_clip_force': {
      // 업로드는 수 분 걸려 라우트가 202 로 바로 답하고 뒤에서 돈다 — 결과는 서버가 따로 알린다.
      // (기다리면 Node fetch 의 응답 헤더 제한 5분에 끊겨, 올라갔는데 '실패'로 알리게 된다.)
      const force = a.kind === 'shorts_clip_force';
      const r = await call(`/shorts/${a.id}/naver-clip`, force ? { force: true } : {});
      if (!r.ok) {
        if (!force && await sendThumbQaGuide(r, a.id, 'clip', send)) return '';
        if (await sendFactHoldGuide(r, a.id, 'clip', send)) return '';
        if (r.json?.submitted === true) {
          await send.html(errText('네이버 클립', r), [[{ text: '🔎 클립 확인', callback_data: `nk:${a.id}` }]]);
          return '';
        }
        return errText('네이버 클립 업로드 실패', r);
      }
      return `🟩 네이버 클립 업로드 시작${force ? '(썸네일 확인 강행)' : ''} — 몇 분 걸립니다. 끝나면 결과를 알려드릴게요.`;
    }
    case 'shorts_clip_check': {
      // '등록 뒤 미확인' 편을 푼다 — 올리지 않고 공개 목록만 본다(1분 안팎). 결과 문구는 서버 알림과 같은 규칙.
      const r = await call(`/shorts/${a.id}/naver-clip`, { check: true }, 5 * 60_000);
      if (!r.ok) {
        // 아직 처리 중(번호 없음·초안으로 보임) — 실패가 아니니 다시 확인할 버튼을 준다.
        if (r.json?.submitted === true) {
          await send.html(errText('네이버 클립 확인', r), [[{ text: '🔎 다시 확인', callback_data: `nk:${a.id}` }]]);
          return '';
        }
        return errText('클립 확인 실패', r);
      }
      if (r.json?.status === 'NOT_FOUND') {
        await send.html('🔎 공개된 클립이 없습니다 — 다시 올릴 수 있습니다.', [[{ text: '🟩 네이버 클립', callback_data: `nc:${a.id}` }]]);
        return '';
      }
      const url = typeof r.json?.url === 'string' ? `\n${escapeHtml(r.json.url)}` : '';
      return `🟩 네이버 클립 확인 — 공개돼 있어 기록했습니다${url}`;
    }
    case 'shorts_fact_force': {
      // 근거 없는 문장을 보고 확인한 뒤의 강행 — 썸네일 QA 는 이 단계 전에 이미 통과(또는 확인)했다.
      const both = { force: true, forceFact: true };
      if (a.ch === 'clip') {
        const r = await call(`/shorts/${a.id}/naver-clip`, both);
        if (!r.ok) return errText('네이버 클립 업로드 실패', r);
        return '🟩 네이버 클립 업로드 시작(사실 검증 확인 강행) — 몇 분 걸립니다. 끝나면 결과를 알려드릴게요.';
      }
      if (a.ch === 'instagram') {
        const r = await call(`/shorts/${a.id}/meta`, both);
        if (!r.ok) return errText('릴스 강행 발행 실패', r);
        const link = typeof r.json?.igPermalink === 'string' ? `\n${r.json.igPermalink}` : '';
        return `🎬 인스타 릴스 발행 완료(사실 검증 확인 강행)${link}`;
      }
      const r = await call(`/shorts/${a.id}/youtube`, both);
      if (!r.ok) return errText('유튜브 강행 업로드 실패', r);
      if (r.json?.notified === true) return '';
      const url = typeof r.json?.url === 'string' ? r.json.url : typeof r.json?.youtubeUrl === 'string' ? r.json.youtubeUrl : '';
      return `${ytDoneText(r.json)}(사실 검증 확인 강행)${url ? `\n${url}` : ''}${ytDoneTail(r.json)}`;
    }
    case 'shorts_thumb_regen': {
      // 썸네일만 다시 만든다(수 분). 통과하면 표식이 지워져 발행 게이트가 열린다.
      const r = await call(`/shorts/${a.id}/thumbnail/regenerate`, {}, 300_000);
      if (!r.ok) return errText('썸네일 재생성 실패', r);
      const thumb = shortsThumbPath(a.id);
      if (thumb) await send.photos([thumb], '🖼 썸네일 재생성 완료 — 문구를 확인하고 발행하세요');
      await send.html('아래 버튼으로 이어서 발행하세요.', shortsPublishButtons(a.id));
      return '';
    }
  }
}

/** 이 숏폼의 썸네일 파일 경로(있으면) — 텔레그램 검수 사진용. */
function shortsThumbPath(id: string): string | null {
  const p = path.join(CONFIG.dataDir, 'shorts', id, 'thumbnail.jpg');
  try { return fs.existsSync(p) ? p : null; } catch { return null; }
}
/** 발행 재시도 버튼(두 채널 모두 — 라우트가 채널 전용이면 409 로 막으므로 안전). */
const shortsPublishButtons = (id: string): TgButton[][] => [[
  { text: '▶️ 유튜브 업로드', callback_data: `sy:${id}` },
  { text: '🎬 릴스 발행', callback_data: `sm:${id}` },
  { text: '🟩 네이버 클립', callback_data: `nc:${id}` },
]];
/**
 * 썸네일 한글 QA 미해결(409) 안내 — 카드뉴스의 '확인 후 강행' 2단계를 숏폼에 맞춘 것(2026-09-16).
 * 썸네일을 보내 눈으로 검수하게 하고, 다시 만들기와 강행 발행 두 길을 준다. 안내를 보냈으면 true.
 */
async function sendThumbQaGuide(
  r: { status: number; json: Record<string, unknown> | null }, id: string, ch: 'youtube' | 'instagram' | 'clip',
  send: Senders = REAL_SENDERS,
): Promise<boolean> {
  if (r.status !== 409 || r.json?.thumb_qa_unresolved !== true) return false;
  const thumb = shortsThumbPath(id);
  if (thumb) await send.photos([thumb], '⚠️ 썸네일 한글 오타 의심');
  const forceOp = ch === 'youtube' ? 'yf' : ch === 'clip' ? 'nf' : 'mf';
  const forceLabel = ch === 'instagram' ? '✅ 확인했어요 — 강행 발행' : '✅ 확인했어요 — 강행 업로드';
  await send.html(
    '⚠️ 썸네일 한글 QA 미해결 — 위 이미지의 글자를 확인하세요.\n'
    + '문구가 정상이면 강행하고, 글자가 깨졌으면 썸네일을 다시 만드세요(수 분).\n'
    + `✍ 수정요청은 대본만 고치므로 이 경고는 그대로 남습니다.\n${studioBase()}/`,
    [[
      { text: '🖼 썸네일 다시 만들기', callback_data: `tr:${id}` },
      { text: forceLabel, callback_data: `${forceOp}:${id}` },
    ]],
  );
  return true;
}

/**
 * 사실 검증 보류(409 fact_hold) 안내(2026-10-12 사장님 확정) — 카드뉴스 오타 QA 처럼 '확인 후 강행' 2단계.
 * 근거 없는 문장을 다시 보여 주고 ✍ 수정요청과 강행 두 길을 준다. 안내를 보냈으면 true.
 */
async function sendFactHoldGuide(
  r: { status: number; json: Record<string, unknown> | null }, id: string, ch: 'youtube' | 'instagram' | 'clip',
  send: Senders = REAL_SENDERS,
): Promise<boolean> {
  if (r.status !== 409 || !Array.isArray(r.json?.fact_hold)) return false;
  const items = (r.json!.fact_hold as unknown[]).filter((x): x is string => typeof x === 'string');
  const op = ch === 'youtube' ? 'yh' : ch === 'clip' ? 'nh' : 'mh';
  const label = ch === 'instagram' ? '✅ 확인했어요 — 강행 발행' : '✅ 확인했어요 — 강행 업로드';
  const clip = (t: string): string => escapeHtml(t.length > 90 ? `${t.slice(0, 90)}…` : t);
  await send.html(
    `⚠️ 사실 검증 보류 ${items.length}건 — 근거를 찾지 못한 문장입니다.\n`
    + items.map((t) => `• ${clip(t)}`).join('\n')
    + '\n\n문장이 맞으면 강행하고, 틀렸으면 ✍ 수정요청으로 고치세요.\n'
    + `수정요청은 판정을 다시 돌리지 않아, 고친 뒤 발행할 때도 이 확인이 한 번 나옵니다.\n${studioBase()}/`,
    [[
      { text: '✍ 수정요청', callback_data: `rv:${id}` },
      { text: label, callback_data: `${op}:${id}` },
    ]],
  );
  return true;
}

/** 텔레그램 저수준 호출(응답 JSON 반환) — force_reply 의 message_id 회수 등에 사용. */
async function tgCall(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = tgApiUrl(method);
  if (!url) return null;
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    return await r.json() as Record<string, unknown>;
  } catch { return null; }
}

// 수정요청 대기 — force_reply 로 보낸 안내 message_id → 대상(블로그 piece·카드뉴스·숏폼 id).
// 재시작하면 소실(버튼 다시 누르면 됨).
const pendingRevise = new Map<number, { targetId: string; ts: number }>();
function prunePendingRevise(): void {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1시간 경과 폐기
  for (const [k, v] of pendingRevise) if (v.ts < cutoff) pendingRevise.delete(k);
  while (pendingRevise.size > 50) { const k = pendingRevise.keys().next().value; if (k === undefined) break; pendingRevise.delete(k); }
}

interface TgUpdate {
  update_id: number;
  message?: { message_id: number; date?: number; text?: string; chat?: { id?: number }; reply_to_message?: { message_id?: number } };
  callback_query?: { id: string; data?: string; from?: { id?: number }; message?: { chat?: { id?: number } } };
}

// 오프셋 영속 — 메모리에만 두면 재시작 시 0 부터라 텔레그램이 미확인 업데이트(최대 24h)를 전부 재전달하고,
// 다운타임 중 눌린 버튼들이 부팅 순간 일제히 재실행된다. 배치마다 저장(원자적 교체, 실패 무해).
const OFFSET_FILE = path.join(CONFIG.dataDir, 'telegram-bot.json');
function loadOffset(): number {
  try {
    const d = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf-8')) as { offset?: number };
    return typeof d.offset === 'number' && d.offset > 0 ? d.offset : 0;
  } catch { return 0; }
}
function saveOffset(offset: number): void {
  try {
    const tmp = `${OFFSET_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ offset }), 'utf-8');
    fs.renameSync(tmp, OFFSET_FILE);
  } catch { /* 영속 실패 무해 — 다음 배치에서 재시도 */ }
}

async function handleUpdate(u: TgUpdate, chatId: string, bootTs: number): Promise<void> {
  // ── 버튼(callback_query) ──
  const cq = u.callback_query;
  if (cq) {
    // 채팅과 '누른 사람' 둘 다 검사 — 개인 채팅에선 동일하지만, CHAT_ID 를 그룹으로 잘못 설정해도
    // 그룹 구성원이 발행을 트리거하지 못하게 막는 이중 가드.
    if (String(cq.message?.chat?.id ?? '') !== chatId || String(cq.from?.id ?? '') !== chatId) return;
    const action = cq.data ? parseCallback(cq.data) : null;
    void tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: action ? '접수 — 처리 중…' : '알 수 없는 버튼' });
    if (!action) return;
    if (action.kind === 'revise') {
      // 답장 유도 — 답장 텍스트가 도착하면 아래 message 분기가 /revise 로 잇는다.
      const res = await tgCall('sendMessage', {
        chat_id: chatId, text: '✍ 수정 지시를 이 메시지에 답장(Reply)으로 보내주세요.',
        reply_markup: { force_reply: true },
      });
      const mid = (res?.result as { message_id?: number } | undefined)?.message_id;
      if (typeof mid === 'number') { pendingRevise.set(mid, { targetId: action.id, ts: Date.now() }); prunePendingRevise(); }
      return;
    }
    // 발행류는 수 초~수 분 — 폴 루프를 막지 않게 비동기로 돌리고 끝나면 결과를 새 메시지로 push.
    // 실패(타임아웃·재시작 중 ECONNREFUSED 등)도 반드시 사용자에게 알린다 — '접수'만 보고 무소식이면 안 됨.
    void runAction(action)
      .then((msg) => {
        // 실패 결과는 서버 로그에도 — 텔레그램 답장만 남기면 사유를 나중에 찾을 수 없었다(2026-10-13 배나무 카드뉴스).
        if (msg.startsWith('⚠️')) console.log(`[텔레그램] 버튼 실패 — ${action.kind} ${action.id}: ${msg.slice(0, 300)}`);
        if (msg) void sendTelegramHtml(msg); // ''=QA 안내처럼 액션이 직접 전송한 경우
      })
      .catch((e: unknown) => {
        console.log(`[텔레그램] 버튼 처리 실패 — ${action.kind} ${action.id}: ${e instanceof Error ? e.message : String(e)}`);
        return sendTelegramHtml(`⚠️ 처리 실패 — ${escapeHtml(e instanceof Error ? e.message : String(e))}`);
      });
    return;
  }
  // ── 텍스트 메시지 ──
  const m = u.message;
  if (!m || String(m.chat?.id ?? '') !== chatId) return;
  if ((m.date ?? 0) < bootTs) return; // 부팅 이전 잔여 메시지 — 조용히 드레인
  const text = (m.text ?? '').trim();
  if (!text) return;
  const replyTo = m.reply_to_message?.message_id;
  if (typeof replyTo === 'number') {
    const pending = pendingRevise.get(replyTo);
    if (pending) {
      pendingRevise.delete(replyTo);
      const ep = reviseEndpointFor(pending.targetId);
      if (ep.derived) {
        // 카드뉴스·숏폼 revise 는 수 분짜리 동기 라우트 — 폴 루프를 막지 않게 비동기 실행 후 결과 push.
        void sendTelegramHtml(`✍ ${ep.label} 수정 반영 중… (부분 재생성 — ${ep.label === '숏폼' ? '모션그래픽까지 10~30분' : '수 분'} 소요)`);
        void apiLong(ep.path, { feedback: text }, DERIVED_REVISE_TIMEOUT_MS)
          .then((r) => sendTelegramHtml(r.ok ? `✍ ${ep.label} 수정 반영 완료 — 갱신본 알림을 확인하세요.` : errText(`${ep.label} 수정 요청 실패`, r)))
          .catch((e: unknown) => sendTelegramHtml(`⚠️ ${ep.label} 수정 요청 실패 — ${escapeHtml(e instanceof Error ? e.message : String(e))}`));
      } else {
        const r = await api(ep.path, { feedback: text }, 30_000);
        void sendTelegramHtml(r.ok ? '✍ 수정 런 시작 — 완료되면 ↻ 개정본 알림이 옵니다.' : errText('수정 요청 실패', r));
      }
    } else {
      // 재시작으로 대기 맵이 소실된 답장 — 지시 텍스트가 버려졌음을 명확히 알린다(조용한 폐기 금지).
      void sendTelegramHtml('⏳ 수정 요청 세션이 만료됐습니다 — 알림 메시지의 ✍ 수정요청 버튼을 다시 눌러주세요.');
    }
    return;
  }
  // 자율런 지시(2026-09-10) — 문장으로 주제 범위를 정해 두면 자율런이 그 안에서만 고른다.
  const dc = parseDirectiveCommand(text);
  if (dc) {
    const body = dc.kind === 'set' ? { text: dc.text, on: true, ...(dc.maxPieces ? { maxPieces: dc.maxPieces } : {}) }
      : dc.kind === 'off' ? { on: false } : dc.kind === 'on' ? { on: true } : dc.kind === 'clear' ? { text: '' } : {};
    const r = await api('/autonomy/directive', body, 15_000);
    if (!r.ok) { void sendTelegramHtml(errText('자율런 지시 실패', r)); return; }
    const d = (r.json?.directive ?? null) as { text: string; on: boolean; made: number; maxPieces?: number; lastResult?: string } | null;
    const head = dc.kind === 'set' ? '📝 자율런 지시 설정 — 다음 틱부터 이 범위 안에서 주제를 고릅니다.\n' : dc.kind === 'off' ? '⏸ 지시를 껐습니다 — 기존 자율런으로 돕니다.\n' : dc.kind === 'clear' ? '🗑 지시를 지웠습니다.\n' : '';
    void sendTelegramHtml(`${head}${escapeHtml(describeDirective(d))}`);
    return;
  }
  // 명령이 아닌 일반 텍스트 — 짧은 안내(발행은 알림 메시지의 버튼으로).
  void sendTelegramHtml(`📌 발행·수정은 검토 대기 알림 메시지의 버튼으로 할 수 있습니다.\n자율런 지시: "자율런 지시: …" · "지시 상태" · "지시 끄기"\n스튜디오: ${studioBase()}/`);
}

let started = false;

/** 폴러 기동(1회) — 자격 미설정이면 유휴 대기(설정 즉시 자동 재개, .env 매 폴 재읽기). */
export function startTelegramBot(): void {
  if (started) return;
  started = true;
  const bootTs = Math.floor(Date.now() / 1000);
  let offset = loadOffset();
  let announced = false;
  let failStreak = 0;      // 연속 실패 횟수 — 백오프 5s→최대 60s 에스컬레이션(죽은 토큰으로 API 두들기지 않기)
  let lastFailLogTs = 0;   // 실패 로그 스로틀(60s) — 지속 실패를 '진단 가능하되 로그 홍수 없이' 남긴다
  const logFail = (why: string): void => {
    failStreak++;
    if (Date.now() - lastFailLogTs > 60_000) { lastFailLogTs = Date.now(); console.log(`[텔레그램] getUpdates 실패(연속 ${failStreak}) — ${why.slice(0, 200)}`); }
  };
  void (async () => {
    for (;;) {
      const tg = telegramCreds();
      if (!tg) { announced = false; await sleep(60_000); continue; }
      if (!announced) { announced = true; console.log('[텔레그램] 봇 수신 폴러 시작 — 검토 알림 발행 버튼 활성'); }
      const base = tgApiUrl('getUpdates');
      if (!base) { await sleep(5_000); continue; } // 자격이 방금 지워진 레이스 — 다음 루프의 creds 체크로 수렴
      try {
        const url = `${base}?timeout=50${offset ? `&offset=${offset}` : ''}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        const d = await r.json() as { ok?: boolean; description?: string; result?: TgUpdate[] };
        if (!d.ok) { logFail(d.description ?? `HTTP ${r.status}`); await sleep(Math.min(60_000, 5_000 * failStreak)); continue; }
        if (failStreak) { console.log(`[텔레그램] getUpdates 복구(연속 실패 ${failStreak}회 후)`); failStreak = 0; }
        for (const u of d.result ?? []) {
          offset = Math.max(offset, u.update_id + 1);
          try { await handleUpdate(u, tg.chatId, bootTs); } catch { /* 무해 — 다음 업데이트 계속 */ }
        }
        if (d.result?.length) saveOffset(offset);
      } catch (e) {
        logFail(e instanceof Error ? e.message : String(e));
        await sleep(Math.min(60_000, 5_000 * failStreak));
      }
    }
  })();
}
