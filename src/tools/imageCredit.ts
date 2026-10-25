/**
 * OpenAI 이미지 잔액 소진 — 감지·멈춤·재개(2026-10-25 사장님 요청).
 *
 * 10-25 17시 인스타 숏폼이 씬 그림 4/4장 실패(429 insufficient_quota)인데도 그라데이션 배경 4씬으로 끝까지 만들어져
 * 검토 알림까지 갔다. 잔액이 없으면 그림이 비는 결과물은 만들지 않는다:
 *   - 그림 생성 통로(generateImagesForDraft·image_generate·모션그래픽 시안)가 잔액 오류를 보면 표시한다(markImageCreditOut).
 *   - 표시 중에는 숏폼을 새로 시작하지 않고, 그림 단계에서 걸린 편은 멈춘다. 멈춘·미룬 편은 deferred 로 남긴다.
 *   - 텔레그램으로 충전 필요를 알리고, 충전 확인(1토큰 채팅 호출 — /v1/models 는 잔액이 없어도 200)이 되면 deferred 를 다시 만든다.
 * 카드뉴스·블로그는 멈추지 않는다 — 생성 사진이 비면 블로그 사진·실촬영·도표로 채워져 결과물이 망가지지 않는다.
 * 상태는 data/image-credit.json — 재시작해도 이어진다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import { sendTelegramHtml } from '../autonomy/notify';

const CREDIT_RE = /insufficient_quota|credit_balance_exhausted|no credits remaining|billing_hard_limit/i;
export const IMAGE_CREDIT_STOP = 'OpenAI 이미지 잔액 소진';
export const BILLING_URL = 'https://platform.openai.com/settings/organization/billing';
/** 소진 중 다시 알리는 간격 — 첫 알림을 놓쳐도 잊히지 않게. */
export const CREDIT_REMIND_MS = 6 * 3600_000;
/** 미룬 편 보관 기한 — 일주일 넘게 충전 안 하면 묵은 주제를 한꺼번에 쏟지 않는다. */
export const CREDIT_DEFER_MAX_MS = 7 * 86_400_000;

/** 잔액 소진 오류 문구인가(순수) — 매니페스트 error·스크립트 출력·HTTP 본문 어디서 와도 같은 판정. */
export function isCreditExhausted(text: unknown): boolean {
  return CREDIT_RE.test(String(text ?? ''));
}

export class ImageCreditError extends Error {
  constructor() { super(`${IMAGE_CREDIT_STOP} — 충전 확인 뒤 자동으로 다시 만듭니다`); this.name = 'ImageCreditError'; }
}

export interface CreditDeferred {
  /** 다시 만들 원본 글 — 없으면(주제 직접 입력 편) 알림에만 싣는다. */
  pieceId?: string;
  shortId?: string;
  platform?: string;
  /** 자율런 상한 적용 편이었는가 — 다시 만들 때도 같은 표시로(platformQuotaCommitted 가 센다). */
  auto?: boolean;
  title: string;
  ts: string;
}
export interface CreditState { outSince?: string; lastAlertTs?: string; source?: string; deferred: CreditDeferred[] }

// 시험은 실제 data 폴더를 그대로 쓴다 — 운영 상태 파일을 읽어 숏폼 시험이 잔액 확인을 부르거나, 시험이 운영 상태를 바꾸지 않게 따로 둔다.
const defaultFile = (): string => (process.env.VITEST
  ? path.join(os.tmpdir(), `image-credit-vitest-${process.pid}.json`)
  : path.join(CONFIG.dataDir, 'image-credit.json'));

export function loadCreditState(file = defaultFile()): CreditState {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CreditState>;
    return { ...j, deferred: Array.isArray(j.deferred) ? j.deferred : [] };
  } catch { return { deferred: [] }; }
}
function saveCreditState(s: CreditState, file: string): void {
  try {
    // 임시 파일에 쓰고 바꿔 끼운다 — 쓰는 도중 죽어 JSON 이 깨지면 표시와 미룬 편이 함께 사라진다.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.log(`[이미지 잔액] 상태 저장 실패(무해): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function imageCreditOut(file = defaultFile()): boolean {
  return !!loadCreditState(file).outSince;
}

/** 알림을 보내고, 보낸 것이 확인됐을 때만 lastAlertTs 를 남긴다 — 재시작·전송 실패로 첫 알림이 사라지면 다음 주기 점검이 다시 보낸다. */
async function sendAlert(html: string, file: string, now: Date): Promise<void> {
  const ok = await sendTelegramHtml(html).catch(() => false);
  if (!ok) return;
  const cur = loadCreditState(file);
  if (cur.outSince) saveCreditState({ ...cur, lastAlertTs: now.toISOString() }, file);
}

/** 소진 표시 — 처음 표시할 때만 true. 첫 알림은 30초 뒤(그 사이 멈춘 편이 deferred 에 들어와 알림에 실린다). */
export function markImageCreditOut(source: string, file = defaultFile(), now = new Date()): boolean {
  const s = loadCreditState(file);
  if (s.outSince) return false;
  saveCreditState({ ...s, outSince: now.toISOString(), source }, file);
  console.log(`[이미지 잔액] 소진 감지(${source}) — 숏폼 자동 제작 멈춤, 충전 확인 대기`);
  const t = setTimeout(() => { const cur = loadCreditState(file); if (cur.outSince && !cur.lastAlertTs) void sendAlert(creditAlertHtml('out', loadCreditState(file)), file, now); }, 30_000);
  t.unref?.();
  return true;
}

/** 다시 만들 편 등록 — 같은 글·같은 채널(또는 같은 편)은 한 번만. */
export function deferForCredit(d: Omit<CreditDeferred, 'ts'>, file = defaultFile(), now = new Date()): void {
  const s = loadCreditState(file);
  const same = (x: CreditDeferred): boolean => (d.pieceId
    ? x.pieceId === d.pieceId && (x.platform ?? '') === (d.platform ?? '')
    : !!d.shortId && x.shortId === d.shortId);
  if (s.deferred.some(same)) return;
  saveCreditState({ ...s, deferred: [...s.deferred, { ...d, ts: now.toISOString() }] }, file);
}

/** 소진 해제 — 보관 기한 안의 미룬 편을 돌려준다. */
export function clearImageCredit(file = defaultFile(), now = new Date()): CreditDeferred[] {
  const s = loadCreditState(file);
  saveCreditState({ deferred: [] }, file);
  return s.deferred.filter((d) => now.getTime() - Date.parse(d.ts) <= CREDIT_DEFER_MAX_MS);
}

/** 잔액 확인(1토큰 채팅) — /v1/models·moderations 는 잔액이 없어도 200 이라 못 쓴다(10-25 실측).
 *  2xx = ok, 429+잔액 문구 = out, 그 밖(망 오류·401·403·404·일반 429)은 unknown — 상태 유지.
 *  확인이 계속 unknown 이어도 영영 멈추지 않는다: 블로그·카드뉴스의 실제 그림이 한 장이라도 나오면 풀린다(noteImageOk).
 *  400·404 를 ok 로 보면 모델이 폐기된 날 '해제 → 숏폼 대본 → 그림 429 → 다시 표시'가 10분마다 돈다(검토 지적). */
export async function probeImageCredit(fetchImpl: typeof fetch = fetch): Promise<'ok' | 'out' | 'unknown'> {
  if (!CONFIG.openaiApiKey) return 'ok';
  try {
    const r = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.openaiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) return 'ok';
    const body = await r.text().catch(() => '');
    return r.status === 429 && isCreditExhausted(body) ? 'out' : 'unknown';
  } catch { return 'unknown'; }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 텔레그램 알림 본문(순수). out = 첫 감지, remind = 아직 소진, back = 충전 확인. */
export function creditAlertHtml(kind: 'out' | 'remind' | 'back', s: CreditState, replayed: CreditDeferred[] = []): string {
  const items = (kind === 'back' ? replayed : s.deferred).slice(0, 8)
    .map((d) => `• ${esc(d.title.slice(0, 40))}${d.platform ? ` (${d.platform === 'instagram' ? '인스타' : d.platform === 'youtube' ? '유튜브' : esc(d.platform)})` : ''}${d.pieceId ? '' : ' — 직접 다시 만들어야 함'}`);
  if (kind === 'back') {
    const left = s.deferred.length - replayed.length;
    return [
      '✅ <b>OpenAI 이미지 잔액 확인 — 숏폼 자동 제작 재개</b>',
      items.length ? `멈췄던 편을 다시 만듭니다:\n${items.join('\n')}` : '다시 만들 편은 없습니다.',
      left > 0 ? `${left}편은 다시 만들지 않았습니다(오늘 몫이 찼거나, 그새 다른 편이 있거나, 자율 제작이 꺼져 있음 — 서버 로그 참고).` : '',
    ].filter(Boolean).join('\n\n');
  }
  return [
    `🔴 <b>${kind === 'out' ? 'OpenAI 이미지 잔액 소진' : 'OpenAI 이미지 잔액 아직 소진'} — 충전이 필요합니다</b>`,
    '숏폼은 그림 없이 만들지 않도록 멈췄습니다. 카드뉴스·블로그는 블로그 사진·실촬영·도표로 계속 만듭니다(생성 사진은 빠짐).',
    items.length ? `충전되면 다시 만들 편:\n${items.join('\n')}` : '',
    `충전: ${BILLING_URL}\n충전하면 10분 안에 자동으로 확인하고 이어서 만듭니다.`,
  ].filter(Boolean).join('\n\n');
}

/** 다시 만들기 — 실제로 다시 만든 편을 돌려준다(재개 알림에 그것만 싣는다). */
type BackFn = (list: CreditDeferred[]) => CreditDeferred[];
let onBack: BackFn | null = null;
/** 충전 확인 시 미룬 편을 다시 만드는 쪽(서버)이 등록한다. */
export function onImageCreditBack(fn: BackFn): void { onBack = fn; }

/** 해제·재개 알림·다시 만들기(한 곳) — 잔액 확인 ok 와 실제 그림 성공이 같이 쓴다. */
function recover(s: CreditState, file: string, now: Date, why: string): void {
  const list = clearImageCredit(file, now);
  console.log(`[이미지 잔액] 충전 확인(${why}) — 숏폼 자동 제작 재개 · 미룬 편 ${list.length}개`);
  let made: CreditDeferred[] = [];
  try { made = onBack?.(list) ?? []; } catch (e) { console.log(`[이미지 잔액] 다시 만들기 실패: ${e instanceof Error ? e.message : String(e)}`); }
  void sendTelegramHtml(creditAlertHtml('back', { ...s, deferred: list }, made)).catch(() => { /* 무해 */ });
}

/** 실제 그림이 한 장이라도 나왔다 — 표시 중이면 푼다. 잔액 확인 호출이 막혀 있어도(권한·망) 숏폼이 영영 멈추지 않게. */
export function noteImageOk(file = defaultFile(), now = new Date()): void {
  const s = loadCreditState(file);
  if (s.outSince) recover(s, file, now, '그림 생성 성공');
}

/** 그림을 그려도 되는가 — 소진 표시가 없으면 바로 true. 표시 중이면 잔액을 확인해 돌아왔으면 해제·재개 알림·미룬 편 재생성,
 *  아직이면 false(+ 6시간마다 다시 알림). 서버 주기 점검과 숏폼 시작이 같이 쓴다. */
let checking: Promise<boolean> | null = null;
export function checkImageCredit(fetchImpl: typeof fetch = fetch, file = defaultFile(), now = new Date()): Promise<boolean> {
  // 주기 점검과 숏폼 시작이 겹쳐도 확인·재생성은 한 번만.
  checking ??= checkOnce(fetchImpl, file, now).finally(() => { checking = null; });
  return checking;
}
async function checkOnce(fetchImpl: typeof fetch, file: string, now: Date): Promise<boolean> {
  const s = loadCreditState(file);
  if (!s.outSince) return true;
  const p = await probeImageCredit(fetchImpl);
  if (p === 'ok') {
    recover(s, file, now, '잔액 확인');
    return true;
  }
  // 첫 알림을 못 보냈으면(재시작·전송 실패) 첫 알림 문구로, 보냈으면 6시간마다 '아직 소진'.
  if (!s.lastAlertTs) await sendAlert(creditAlertHtml('out', s), file, now);
  else if (now.getTime() - Date.parse(s.lastAlertTs) >= CREDIT_REMIND_MS) await sendAlert(creditAlertHtml('remind', s), file, now);
  return false;
}
