/**
 * 시크릿(API 키) 저장소 — 값은 프로젝트 루트 `.env` 한 곳에만 저장한다(사용자 요청: 저장소 일원화).
 * 부팅 시 process.loadEnvFile() 이 같은 파일을 읽으므로 '.env = 단일 소스'. UI 편집은 파일을
 * 원자적으로 고쳐 쓰고(주석·다른 줄 보존, 0600) process.env 에도 미러링해 재시작 없이 반영한다.
 * data/secrets.json 은 메타데이터(사용자 키 정의 custom·숨긴 기본 키 hidden)만 남고, 과거 값은
 * 최초 접근 시 .env 로 1회 이관된다. 화면엔 항상 마스킹만 노출.
 * builtin 키(Anthropic/OpenAI/커넥터)는 정의가 코드에 있으므로 삭제 시 '숨김'(값 제거+카드 제거,
 * 복원 가능), 사용자 키는 추가·완전 삭제 가능.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { connectorKeyDefs } from '../grounding/registry'; // pure 모듈(순환 없음). 등록은 main 이 grounding 을 import 하며 수행.

const FILE = path.join(CONFIG.dataDir, 'secrets.json');           // 메타데이터(custom·hidden)만
const ENV_FILE = process.env.GEPA_ENV_FILE || path.resolve(process.cwd(), '.env'); // 값 저장소(단일)

export interface ApiKeyInfo {
  key: string; label: string; icon: string; desc: string;
  placeholder: string; needs_restart: boolean; set: boolean; masked: string; builtin: boolean;
}
interface CustomDef { key: string; label: string; icon: string; desc: string }
interface Meta { custom: CustomDef[]; hidden: string[] }

interface BuiltinDef { key: string; label: string; icon: string; desc: string; placeholder: string; needs_restart: boolean }
const BUILTIN: BuiltinDef[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', icon: '🟣', desc: 'Claude 클라우드 백엔드 사용 시 필요', placeholder: 'sk-ant-…', needs_restart: true },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', icon: '🟢', desc: 'OpenAI 호환 백엔드(선택)', placeholder: 'sk-…', needs_restart: true },
  // 알림 채널(자율 사이클 완료·일일 브리핑) — 설정하면 자동 발송. 미설정이면 알림 no-op.
  { key: 'NOTIFY_WEBHOOK_URL', label: '알림 웹훅', icon: '🔔', desc: '자율 사이클·일일 브리핑을 POST 할 URL(Slack/Discord/커스텀)', placeholder: 'https://hooks.…', needs_restart: false },
  { key: 'TELEGRAM_BOT_TOKEN', label: '텔레그램 봇 토큰', icon: '📨', desc: '텔레그램 알림(봇 토큰 + 챗 ID 둘 다 설정 시 발송)', placeholder: '123456:ABC…', needs_restart: false },
  { key: 'TELEGRAM_CHAT_ID', label: '텔레그램 챗 ID', icon: '💬', desc: '알림을 받을 텔레그램 chat_id', placeholder: '123456789', needs_restart: false },
  // 네이버 임시저장(검토 탭) — 블로그 ID 필수, 로그인 자격증명은 자동입력 보조(없으면 열린 브라우저에서 직접 로그인).
  { key: 'NAVER_BLOG_ID', label: '네이버 블로그 — 블로그 ID', icon: '📗', desc: '임시저장 대상 블로그 아이디(blog.naver.com/<이 값>) — 검토 탭 "네이버 임시저장"에 필수', placeholder: '예: myblog', needs_restart: false },
  { key: 'NAVER_LOGIN_ID', label: '네이버 로그인 — 아이디', icon: '🔑', desc: '(선택) 임시저장 브라우저 자동 로그인용 — 미설정 시 열린 브라우저에서 직접 로그인', placeholder: '네이버 아이디', needs_restart: false },
  { key: 'NAVER_LOGIN_PW', label: '네이버 로그인 — 비밀번호', icon: '🔑', desc: '(선택) 자동 로그인용 비밀번호 — .env 에만 저장·화면엔 마스킹', placeholder: '비밀번호', needs_restart: false },
  // 법령(LAW)·DART 등 외부 데이터 소스 키는 그라운딩 커넥터(grounding/)가 선언 → connectorKeyDefs 로 합류.
];
// 커넥터가 선언한 키도 '내장 키'처럼 다룬다(값 편집만, 삭제=숨김, 설정 시 자동 연동).
const connDefs = (): BuiltinDef[] =>
  connectorKeyDefs().map((d) => ({ key: d.key, label: d.label, icon: d.icon, desc: d.desc, placeholder: d.placeholder, needs_restart: false }));
const builtinDefs = (): BuiltinDef[] => [...BUILTIN, ...connDefs()];
const isBuiltinKey = (k: string): boolean => builtinDefs().some((b) => b.key === k);

// ── .env 파싱/편집 (순수 텍스트 변환 — 테스트 대상) ─────────────────────────
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** .env 텍스트 → 값 맵. 주석 무시, 따옴표 제거, 같은 키 중복 시 마지막 값. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = ENV_LINE.exec(line);
    const k = m?.[1], raw = m?.[2];
    if (!k || raw === undefined) continue;
    let v = raw.trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      const dq = v.startsWith('"');
      v = v.slice(1, -1);
      // 이중따옴표만 이스케이프 해제(작성 시 quoteEnv 와 대칭)
      if (dq) v = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    out[k] = v;
  }
  return out;
}
function quoteEnv(v: string): string {
  return /[\s#'"\\]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}
/**
 * .env 텍스트에서 key 라인을 교체/삭제/추가한 새 텍스트 반환(순수).
 * 주석·다른 키·빈 줄은 그대로 보존. 같은 키 중복 라인은 하나로 정리.
 * value === undefined → 해당 키 라인 제거.
 */
export function upsertEnvText(text: string, key: string, value: string | undefined): string {
  const lines = text.length ? text.split(/\r?\n/) : [];
  const kept: string[] = [];
  let replaced = false;
  for (const line of lines) {
    const m = ENV_LINE.exec(line);
    if (m?.[1] === key && !/^\s*#/.test(line)) {
      if (value !== undefined && !replaced) { kept.push(`${key}=${quoteEnv(value)}`); replaced = true; }
      continue; // 삭제 대상 또는 중복 라인 스킵
    }
    kept.push(line);
  }
  if (value !== undefined && !replaced) {
    while (kept.length && kept[kept.length - 1] === '') kept.pop();
    kept.push(`${key}=${quoteEnv(value)}`);
  }
  return kept.join('\n').replace(/\n*$/, '\n');
}

function readEnvValues(): Record<string, string> {
  try { return parseEnvText(fs.readFileSync(ENV_FILE, 'utf-8')); } catch { return {}; }
}
/** .env 원자적 갱신(0600) + process.env 미러링(부팅 loadEnvFile 값이 낡지 않게 즉시 반영). */
function writeEnvValue(key: string, value: string | undefined): void {
  let text = '';
  try { text = fs.readFileSync(ENV_FILE, 'utf-8'); } catch { /* 새 파일 */ }
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, upsertEnvText(text, key, value), { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  if (value !== undefined) process.env[key] = value;
  else delete process.env[key];
}

// ── 메타데이터(secrets.json) — 레거시 values 는 최초 접근 시 .env 로 1회 이관 ──
function writeMeta(m: Meta): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(m, null, 2), { mode: 0o600 });
}
function readMeta(): Meta {
  let raw: Partial<Meta> & { values?: Record<string, string> };
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Partial<Meta> & { values?: Record<string, string> }; }
  catch { raw = {}; }
  const meta: Meta = { custom: raw.custom ?? [], hidden: raw.hidden ?? [] };
  if (raw.values) {                                   // 레거시(이전 저장소) — .env 에 없는 값만 이관 후 제거
    const cur = readEnvValues();
    for (const [k, v] of Object.entries(raw.values)) if (v && !(k in cur)) writeEnvValue(k, v);
    writeMeta(meta);
  }
  return meta;
}

/** 항상 마스킹 — 앞 4 + 점 + 뒤 4. 짧으면 전부 가림. */
export function maskSecret(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(Math.max(4, v.length));
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}
/** 사람 비밀번호류 키 — 앞4+뒤4 부분노출(maskSecret)도 과다해 전체 마스킹한다(길이도 숨김). */
const FULL_MASK_KEY = /(_PW|_PASSWORD|PASSWORD)$/;
export function maskFor(key: string, v: string): string {
  if (!v) return '';
  return FULL_MASK_KEY.test(key) ? '••••••••' : maskSecret(v);
}
function validKeyName(k: string): boolean { return /^[A-Z][A-Z0-9_]{1,48}$/.test(k); }

export function listKeys(): ApiKeyInfo[] {
  const meta = readMeta();
  const vals = readEnvValues();
  // 표시값 = 런타임(getSecret)과 동일 우선순위: .env 파일 → 실제 환경변수(셸 export 등)
  const val = (k: string): string => vals[k] ?? process.env[k] ?? '';
  const builtin: ApiKeyInfo[] = builtinDefs()
    .filter((b) => !meta.hidden.includes(b.key))
    .map((b) => ({ ...b, set: !!val(b.key), masked: maskFor(b.key, val(b.key)), builtin: true }));
  const custom: ApiKeyInfo[] = meta.custom.map((c) => ({
    key: c.key, label: c.label || c.key, icon: c.icon || '🔑', desc: c.desc || '사용자 정의 키',
    placeholder: '값 입력…', needs_restart: false, set: !!val(c.key), masked: maskFor(c.key, val(c.key)), builtin: false,
  }));
  return [...builtin, ...custom];
}
export function setKey(key: string, value: string): { ok: boolean; error?: string } {
  const meta = readMeta();
  if (!isBuiltinKey(key) && !meta.custom.some((c) => c.key === key)) return { ok: false, error: '알 수 없는 키입니다.' };
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: '값이 비었습니다.' };
  writeEnvValue(key, value.trim());
  return { ok: true };
}
export function addCustom(key: string, label: string, icon: string, value: string): { ok: boolean; error?: string } {
  if (!validKeyName(key)) return { ok: false, error: '키 이름은 대문자·숫자·밑줄만 가능합니다(예: MY_API_KEY).' };
  if (isBuiltinKey(key)) return { ok: false, error: '기본 키와 중복됩니다.' };
  const meta = readMeta();
  if (!meta.custom.some((c) => c.key === key)) meta.custom.push({ key, label: label || key, icon: icon || '🔑', desc: '사용자 정의 키' });
  writeMeta(meta);
  if (value && value.trim()) writeEnvValue(key, value.trim());
  return { ok: true };
}
/** 카드 삭제 — 사용자 키는 완전 제거, 기본 키는 값 제거 + 숨김(restoreKey 로 복원 가능). */
export function deleteKey(key: string): { ok: boolean; error?: string } {
  const meta = readMeta();
  if (isBuiltinKey(key)) {
    if (!meta.hidden.includes(key)) meta.hidden.push(key);
  } else {
    if (!meta.custom.some((c) => c.key === key)) return { ok: false, error: '알 수 없는 키입니다.' };
    meta.custom = meta.custom.filter((c) => c.key !== key);
  }
  writeMeta(meta);
  writeEnvValue(key, undefined);
  return { ok: true };
}
/** 숨긴 기본 키 목록(복원 UI 용) — 커넥터 제거 등으로 정의가 사라진 키는 제외. */
export function hiddenKeys(): { key: string; label: string; icon: string }[] {
  const meta = readMeta();
  return builtinDefs()
    .filter((b) => meta.hidden.includes(b.key))
    .map((b) => ({ key: b.key, label: b.label, icon: b.icon }));
}
/** 숨긴 기본 키 복원 — 카드가 '미설정' 상태로 다시 나타난다(값은 다시 입력). */
export function restoreKey(key: string): { ok: boolean; error?: string } {
  const meta = readMeta();
  if (!meta.hidden.includes(key)) return { ok: false, error: '숨긴 키가 아닙니다.' };
  meta.hidden = meta.hidden.filter((k) => k !== key);
  writeMeta(meta);
  return { ok: true };
}
/** 런타임 시크릿 조회(LLM 클라이언트 등) — .env 파일(단일 저장소) 우선, 실제 환경변수 폴백. */
export function getSecret(key: string): string | undefined {
  return readEnvValues()[key] || process.env[key] || undefined;
}
