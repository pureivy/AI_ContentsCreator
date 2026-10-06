/**
 * 유튜브 쇼츠 커버 자동 지정 — 업로드된 쇼츠의 '채널 쇼츠 탭' 커버를 디자인 커버(shorts-cover.jpg)로 바꾼다.
 *
 * 왜 브라우저인가(실측 2026-09-30): 쇼츠 탭 그리드 이미지는 Studio(데스크톱)에서 지정한 쇼츠 커버만 쓴다.
 * Data API thumbnails.set 은 가로형 화면(검색·홈)만 바뀌고 그리드는 영상 중간 자동 프레임(oar2/oar3)으로 남았다.
 * 그래서 채널 소유 계정(우리는 biondi.tree)이 로그인된 Chrome 을 Claude in Chrome 으로 조작한다 —
 * `claude -p --chrome` 헤드리스 1회(실측 55초·20턴, 구독 정액)로 Studio 세부정보 → 썸네일 업로드 → 저장.
 *
 * 성공 판정은 에이전트 보고가 아니라 공개 이미지로 한다: i.ytimg.com/vi/<id>/sardefault.jpg 가
 * 200 이면 쇼츠 커버 지정됨(그리드가 이 이미지로 전환), 404 면 미지정(실측: 커버 없는 쇼츠 4편 전부 404).
 * 이미 지정된 쇼츠(수동 포함)는 에이전트를 띄우지 않고 확인만 기록한다.
 *
 * 스윕: 10분 주기 · 업로드 10분 뒤부터 · 스윕당 에이전트 1회 · 재시도 간격 30분→2시간→6시간(최대 4회) ·
 * 첫 실패와 포기 시점에만 알림. Chrome 이 꺼져 있어도 주기마다 에이전트를 띄우지 않게 시도 횟수·간격으로 캡.
 *
 * 이식(2026-10-06, 사장님 선택 'ok_asis1 방식 그대로') — 자매 프로젝트 Biz_Contents_Creator 2d20b95 에서 가져왔다.
 * 바꾼 것: 공개 판정(YOUTUBE_PUBLISH_PUBLIC), 브랜드 한정(YT_STUDIO_BRAND — 채널이 브랜드별), 적용 시작 시각(YT_STUDIO_COVER_SINCE —
 * 그 전 업로드는 건드리지 않는다), 알림 문구의 계정명.
 * 주의: 확장(Claude in Chrome)에 로그인한 Claude 계정이 이 서버의 claude CLI 계정과 같아야 연결 목록에 이 Chrome 이 보인다
 * (ok_asis1 10-06 사고 — CLI 로그인 계정을 바꾸자 확장 연결이 끊겨 커버 지정이 전부 실패).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG } from '../config';
import { ensureNeutralCwd } from '../llm/claudeCli';
import { shortsStore, type Shorts } from '../content/shorts';
import { notify } from '../autonomy/notify';
import { ensureShortsThumbnail } from './shortsRender';
import { ensureShortsCover } from './shortsCover';

export type CoverStatus = 'set' | 'unset' | 'unknown';
export interface AgentRun { ok: boolean; reason?: string }

export const STUDIO_COVER_MAX_ATTEMPTS = 4;
/** n번째 재시도 전 최소 대기(분) — 인덱스 = 지금까지 시도 횟수. */
export const STUDIO_COVER_BACKOFF_MIN = [0, 30, 120, 360];
/** 업로드 직후엔 처리 중이라 Studio 편집이 불안정 — 이만큼 지난 뒤 첫 시도. */
export const STUDIO_COVER_MIN_AGE_MIN = 10;
/** 이보다 오래된 업로드는 대상에서 뺀다(삭제·타 채널 영상에 에이전트를 태우지 않게). */
export const STUDIO_COVER_MAX_AGE_DAYS = 14;
export const STUDIO_COVER_SWEEP_MS = 10 * 60_000;

/** 실행 중인 에이전트 — 서버 종료 시 함께 정리(고아 claude 가 Chrome 을 계속 조작하지 않게). */
const liveAgents = new Set<ReturnType<typeof spawn>>();
process.once('exit', () => { for (const c of liveAgents) { try { c.kill('SIGKILL'); } catch { /* 이미 종료 */ } } });

const CHROME_TOOLS = [
  'select_browser', 'tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate',
  'find', 'file_upload', 'computer', 'get_page_text',
].map((t) => `mcp__claude-in-chrome__${t}`);

/** 공개 쇼츠 커버 이미지로 지정 여부 확인 — 200=set, 404=unset, 그 외·네트워크 오류=unknown(시도 소모 안 함). */
export async function studioCoverStatus(videoId: string, fetchImpl: typeof fetch = fetch): Promise<CoverStatus> {
  try {
    const r = await fetchImpl(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/sardefault.jpg`,
      { method: 'GET', signal: AbortSignal.timeout(15_000) });
    try { await r.body?.cancel(); } catch { /* 본문 불필요 */ }
    return r.status === 200 ? 'set' : r.status === 404 ? 'unset' : 'unknown';
  } catch { return 'unknown'; }
}

/** 공개 커버 확인 대상인가(순수) — 확인은 비용이 없어 시도 횟수와 무관(늦게 뜬 성공도 결국 기록). */
export function studioCoverCheckDue(s: Shorts, nowMs: number, sinceMs = 0): boolean {
  if (!s.youtubeId || s.ytStudioCoverTs) return false;
  const up = Date.parse(s.youtubeTs ?? '');
  if (!Number.isFinite(up) || up < sinceMs) return false;
  const age = nowMs - up;
  return age >= STUDIO_COVER_MIN_AGE_MIN * 60_000 && age <= STUDIO_COVER_MAX_AGE_DAYS * 86_400_000;
}

/** 에이전트를 띄울 차례인가(순수) — 확인 대상 + 최대 횟수 미만 + 재시도 간격 경과. */
export function studioCoverDue(s: Shorts, nowMs: number, sinceMs = 0): boolean {
  if (!studioCoverCheckDue(s, nowMs, sinceMs)) return false;
  const attempts = s.ytStudioCoverAttempts ?? 0;
  if (attempts >= STUDIO_COVER_MAX_ATTEMPTS) return false;
  if (attempts > 0) {
    const last = Date.parse(s.ytStudioCoverAttemptTs ?? '');
    const gap = (STUDIO_COVER_BACKOFF_MIN[attempts] ?? STUDIO_COVER_BACKOFF_MIN.at(-1)!) * 60_000;
    if (Number.isFinite(last) && nowMs - last < gap) return false;
  }
  return true;
}

/** 헤드리스 에이전트 지시문(순수) — 2026-09-30 실측 UI 기준. 사람 부재: 질문 금지·이상 시 실패 보고. */
export function buildStudioCoverPrompt(o: { videoId: string; coverPath: string; channelId: string; deviceId: string }): string {
  return [
    'You are automating ONE task in YouTube Studio through the Claude in Chrome browser tools. No human is watching: never ask questions. If anything is unexpected, stop and report failure.',
    '',
    `Task: set the custom Shorts thumbnail of video ${o.videoId} to the local image file below, then save.`,
    `Image file: ${o.coverPath}`,
    '',
    'Steps (follow exactly):',
    `1. Load the browser tools with ToolSearch, one call: select:${CHROME_TOOLS.join(',')}`,
    `2. Call select_browser with deviceId "${o.deviceId}". Do not use any other browser.`,
    '3. Call tabs_context_mcp with createIfEmpty=true. If the group already has tabs left over from an earlier run, close each of them with tabs_close_mcp first. Then create a fresh tab with tabs_create_mcp and work only in that tab.',
    `4. Navigate to https://studio.youtube.com/channel/${o.channelId}/videos/short and wait 4 seconds. If the page says "권한이 없습니다" or "오류가 발생했습니다", or it is not the "채널 콘텐츠" page, stop: reply {"ok":false,"reason":"채널 접근 불가"}.`,
    `5. Navigate to https://studio.youtube.com/video/${o.videoId}/edit and wait 5 seconds. It must be the "동영상 세부정보" editor. Otherwise stop with ok:false.`,
    '6. Use find to locate the hidden file input element (input type=file) inside the "썸네일" section. NEVER click the "파일 업로드" button, the thumbnail tile, or anything that opens a file picker — a native file dialog would hang this run.',
    '7. Call file_upload with paths ["<the image file above>"] and that input\'s ref.',
    '8. Wait 3 seconds. Take a small screenshot (scale 0.5) and confirm the thumbnail preview now shows the uploaded image and that the "저장" button is enabled.',
    '9. Do NOT change any other field (title, description, visibility, etc.), even if a warning is shown on the description.',
    '10. Find the "저장" button with find and click it by its ref (not by coordinates). Then wait up to 10 seconds and confirm success: the toast "변경사항이 저장됨" appears, or the "저장" button becomes disabled again.',
    '11. Close the tab you used with tabs_close_mcp — ALWAYS, also when you stop early because of a failure.',
    '12. Your final reply must be exactly one line of JSON and nothing else: {"ok":true} on success, or {"ok":false,"reason":"<short reason in Korean>"}.',
  ].join('\n');
}

/** 에이전트 최종 답에서 마지막 {"ok":…} JSON 을 뽑는다(순수). 못 찾으면 실패. */
export function parseAgentResult(text: string): AgentRun {
  const hits = String(text ?? '').match(/\{[^{}]*"ok"\s*:\s*(?:true|false)[^{}]*\}/g);
  if (!hits?.length) return { ok: false, reason: '에이전트 결과 해석 불가' };
  try {
    const j = JSON.parse(hits[hits.length - 1]!) as { ok?: unknown; reason?: unknown };
    return j.ok === true ? { ok: true } : { ok: false, reason: String(j.reason ?? '사유 미상').slice(0, 120) };
  } catch { return { ok: false, reason: '에이전트 결과 해석 불가' }; }
}

/** CLI 인자(순수) — 프롬프트는 stdin 으로 넣는다(--allowedTools·--add-dir 가 가변 인자라 위치 인자가 먹힐 수 있음). */
export function studioCoverArgs(model: string, coverDir: string): string[] {
  return [
    '-p', '--chrome', '--model', model,
    '--setting-sources', '', '--no-session-persistence', '--max-turns', '40',
    '--add-dir', coverDir,
    '--disallowedTools', 'AskUserQuestion',
    '--allowedTools', ['ToolSearch', ...CHROME_TOOLS].join(','),
    '--output-format', 'json',
  ];
}

/** `claude -p --chrome` 1회 실행. 구독 로그인 강제(API 키 제거). 실패는 사유 문자열로 반환(throw 없음). */
export function runStudioCoverAgent(prompt: string, coverDir: string, timeoutMs = 6 * 60_000): Promise<AgentRun> {
  return new Promise<AgentRun>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_PROFILE;
    let out = ''; let errTail = ''; let done = false;
    const finish = (r: AgentRun) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const child = spawn(CONFIG.claudeCliPath, studioCoverArgs(CONFIG.ytStudioCoverModel, coverDir),
      { cwd: ensureNeutralCwd(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    liveAgents.add(child);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 이미 종료 */ } finish({ ok: false, reason: `시간 초과(${Math.round(timeoutMs / 60_000)}분)` }); }, timeoutMs);
    child.on('error', (e) => { liveAgents.delete(child); finish({ ok: false, reason: `claude 실행 실패(${e.message.slice(0, 60)})` }); });
    // EPIPE 가드 — 자식이 stdin 을 먼저 닫으면 미처리 오류로 서버가 죽는다(claudeCli.ts 2026-08-27 사고와 동일).
    child.stdin.on('error', () => { /* 무해 — 결과는 close 에서 판정 */ });
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { errTail = (errTail + d.toString()).slice(-400); });
    child.on('close', (code) => {
      liveAgents.delete(child);
      try {
        const j = JSON.parse(out) as { is_error?: boolean; subtype?: string; result?: string };
        if (j.is_error || j.subtype !== 'success') return finish({ ok: false, reason: `에이전트 오류(${j.subtype ?? 'error'}) ${String(j.result ?? '').slice(0, 80)}`.trim() });
        return finish(parseAgentResult(j.result ?? ''));
      } catch {
        return finish({ ok: false, reason: `에이전트 출력 없음(exit=${code}) ${errTail.trim().slice(0, 80)}`.trim() });
      }
    });
    child.stdin.end(prompt);
  });
}

export interface StudioCoverDeps {
  list: () => Shorts[];
  update: (id: string, patch: Partial<Shorts>) => void;
  dirFor: (id: string) => string;
  deviceId: string;
  channelId: string;
  /** 이 시각(ms) 전 업로드는 대상에서 뺀다(YT_STUDIO_COVER_SINCE). */
  sinceMs?: number;
  status?: (videoId: string) => Promise<CoverStatus>;
  ensureCover?: (dir: string) => Promise<string | null>;
  runAgent?: (prompt: string, coverDir: string) => Promise<AgentRun>;
  alert?: (title: string, body: string) => Promise<unknown>;
  log?: (msg: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SweepResult { confirmed: number; uploaded: number; failed: number; skipped: boolean }

let sweeping = false;

/** 1회 스윕 — 대상 쇼츠를 확인·지정. 재진입 방지(겹치면 skipped). */
export async function sweepStudioCovers(deps: StudioCoverDeps): Promise<SweepResult> {
  const res: SweepResult = { confirmed: 0, uploaded: 0, failed: 0, skipped: false };
  if (sweeping) return { ...res, skipped: true };
  sweeping = true;
  const now = deps.now ?? Date.now;
  const status = deps.status ?? ((v: string) => studioCoverStatus(v));
  const ensureCover = deps.ensureCover ?? (async (dir: string) => {
    await ensureShortsThumbnail(dir).catch(() => null); // 디자인 썸네일이 없으면 영상 프레임으로라도
    return ensureShortsCover(dir);
  });
  const runAgent = deps.runAgent ?? runStudioCoverAgent;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});
  const alert = deps.alert ?? ((title: string, body: string) => notify({ title, body }));
  try {
    const since = deps.sinceMs ?? 0;
    const due = deps.list().filter((s) => studioCoverCheckDue(s, now(), since))
      .sort((a, b) => (b.youtubeTs ?? '').localeCompare(a.youtubeTs ?? ''));
    let agentUsed = false;
    for (const s of due) {
      const label = (s.title ?? s.topic).slice(0, 24);
      const st = await status(s.youtubeId!);
      if (st === 'set') {
        deps.update(s.id, { ytStudioCoverTs: new Date(now()).toISOString(), ytStudioCoverError: undefined });
        res.confirmed++; log(`${label} — 쇼츠 커버 지정 확인됨`);
        continue;
      }
      // 상태 불명은 시도 소모 없이 다음 주기 / 에이전트는 스윕당 1회 / 횟수·간격 캡(확인만 계속)
      if (st === 'unknown' || agentUsed || !studioCoverDue(s, now(), since)) continue;
      agentUsed = true;
      const attempts = (s.ytStudioCoverAttempts ?? 0) + 1;
      const base: Partial<Shorts> = { ytStudioCoverAttempts: attempts, ytStudioCoverAttemptTs: new Date(now()).toISOString() };
      // 시도는 실행 '전'에 기록 — 실행 중 서버가 재시작돼도 횟수 캡·재시도 간격이 유지된다(중복 에이전트 방지).
      deps.update(s.id, base);
      const cover = await ensureCover(deps.dirFor(s.id)).catch(() => null);
      let reason: string | undefined;
      let unverified = false;
      if (!cover || !fs.existsSync(cover)) reason = '커버 파일 없음(썸네일·영상 부재)';
      else {
        log(`${label} — Studio 쇼츠 커버 지정 시작(${attempts}/${STUDIO_COVER_MAX_ATTEMPTS})`);
        const r = await runAgent(buildStudioCoverPrompt({ videoId: s.youtubeId!, coverPath: cover, channelId: deps.channelId, deviceId: deps.deviceId }), path.dirname(cover));
        if (!r.ok) reason = r.reason ?? '사유 미상';
        else {
          let ok = false;
          for (let i = 0; i < 4 && !ok; i++) { await sleep(i === 0 ? 3_000 : 15_000); ok = (await status(s.youtubeId!)) === 'set'; }
          if (!ok) { reason = '저장은 보고됐으나 공개 커버 미확인(다음 주기 재확인)'; unverified = true; }
        }
      }
      if (!reason) {
        deps.update(s.id, { ytStudioCoverTs: new Date(now()).toISOString(), ytStudioCoverError: undefined });
        res.uploaded++; log(`${label} — Studio 쇼츠 커버 지정 완료(공개 커버 확인)`);
        continue;
      }
      deps.update(s.id, { ytStudioCoverError: reason });
      res.failed++; log(`${label} — Studio 쇼츠 커버 지정 실패(${attempts}/${STUDIO_COVER_MAX_ATTEMPTS}): ${reason}`);
      // 확인 지연(저장 보고됨)은 알리지 않는다 — 다음 주기 확인에서 대개 바로잡힌다.
      if (!unverified && (attempts === 1 || attempts >= STUDIO_COVER_MAX_ATTEMPTS)) {
        const last = attempts >= STUDIO_COVER_MAX_ATTEMPTS;
        void Promise.resolve(alert(
          last ? '쇼츠 커버 자동 지정 포기' : '쇼츠 커버 자동 지정 실패',
          `"${label}" — ${reason}\n`
          + (last ? '자동 재시도를 멈췄습니다. Studio에서 직접 올려 주세요(파일: data/shorts/' + s.id + '/shorts-cover.jpg).'
            : `biondi.tree 로그인 Chrome 창(Claude 패널 연결)을 열어 두면 자동으로 다시 시도합니다(최대 ${STUDIO_COVER_MAX_ATTEMPTS}회).`),
        )).catch(() => {});
      }
    }
    return res;
  } finally {
    sweeping = false;
  }
}

/** 서버 부팅 시 스윕 타이머 시작(옵트인 YT_STUDIO_COVER). 브라우저·채널 ID 가 없으면 경고만. 정지 함수 반환. */
export function startStudioCoverSweeper(log: (m: string) => void = (m) => console.log('[쇼츠커버]', m)): () => void {
  if (!CONFIG.ytStudioCover) return () => {};
  if (!CONFIG.ytStudioBrowserId || !CONFIG.ytStudioChannelId) {
    log('YT_STUDIO_COVER=true 이지만 YT_STUDIO_BROWSER_ID·YT_STUDIO_CHANNEL_ID 미설정 — 비활성');
    return () => {};
  }
  // 성공 판정(공개 sardefault.jpg)은 공개 영상에서만 가능 — 비공개·일부공개 업로드면 확인 불가로 헛시도만 쌓인다.
  if (!CONFIG.youtubePublishPublic) {
    log('YOUTUBE_PUBLISH_PUBLIC=false — 공개 업로드가 아니라 커버 확인이 불가해 비활성');
    return () => {};
  }
  const store = shortsStore();
  const sinceMs = Date.parse(CONFIG.ytStudioCoverSince);
  const run = () => {
    void sweepStudioCovers({
      // 채널은 브랜드별 — 이 Chrome 이 관리하는 채널의 브랜드 쇼츠만(다른 채널 영상에 에이전트를 태우지 않게).
      list: () => store.list().filter((s) => (s.brand ?? '') === CONFIG.ytStudioBrand),
      update: (id, p) => { store.update(id, p); }, dirFor: (id) => store.dirFor(id),
      deviceId: CONFIG.ytStudioBrowserId, channelId: CONFIG.ytStudioChannelId, log,
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : 0,
    }).catch((e) => log(`스윕 오류(무해): ${e instanceof Error ? e.message : String(e)}`));
  };
  const first = setTimeout(run, 60_000); // 부팅 직후 1분 뒤 1회(재시작으로 밀린 대상 따라잡기)
  const timer = setInterval(run, STUDIO_COVER_SWEEP_MS);
  first.unref?.(); timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
