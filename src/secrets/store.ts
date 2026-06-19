/**
 * 시크릿(API 키) 저장소 — data/secrets.json 에 저장. 화면엔 항상 마스킹만 노출한다.
 * git 미추적: sync(gitsync.ts)는 wiki/raw/sessions 만 커밋하므로 data/ 루트의 secrets.json 은 자동 제외.
 * builtin 키(Anthropic/OpenAI/법제처)는 값 편집만 가능(삭제 불가), 사용자 키는 추가·삭제 가능.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { connectorKeyDefs } from '../grounding/registry'; // pure 모듈(순환 없음). 등록은 main 이 grounding 을 import 하며 수행.

const FILE = path.join(CONFIG.dataDir, 'secrets.json');

export interface ApiKeyInfo {
  key: string; label: string; icon: string; desc: string;
  placeholder: string; needs_restart: boolean; set: boolean; masked: string; builtin: boolean;
}
interface CustomDef { key: string; label: string; icon: string; desc: string }
interface Store { values: Record<string, string>; custom: CustomDef[] }

interface BuiltinDef { key: string; label: string; icon: string; desc: string; placeholder: string; needs_restart: boolean }
const BUILTIN: BuiltinDef[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', icon: '🟣', desc: 'Claude 클라우드 백엔드 사용 시 필요', placeholder: 'sk-ant-…', needs_restart: true },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', icon: '🟢', desc: 'OpenAI 호환 백엔드(선택)', placeholder: 'sk-…', needs_restart: true },
  // 알림 채널(자율 사이클 완료·일일 브리핑) — 설정하면 자동 발송. 미설정이면 알림 no-op.
  { key: 'NOTIFY_WEBHOOK_URL', label: '알림 웹훅', icon: '🔔', desc: '자율 사이클·일일 브리핑을 POST 할 URL(Slack/Discord/커스텀)', placeholder: 'https://hooks.…', needs_restart: false },
  { key: 'TELEGRAM_BOT_TOKEN', label: '텔레그램 봇 토큰', icon: '📨', desc: '텔레그램 알림(봇 토큰 + 챗 ID 둘 다 설정 시 발송)', placeholder: '123456:ABC…', needs_restart: false },
  { key: 'TELEGRAM_CHAT_ID', label: '텔레그램 챗 ID', icon: '💬', desc: '알림을 받을 텔레그램 chat_id', placeholder: '123456789', needs_restart: false },
  // 법령(LAW)·DART 등 외부 데이터 소스 키는 그라운딩 커넥터(grounding/)가 선언 → connectorKeyDefs 로 합류.
];
// 커넥터가 선언한 키도 '내장 키'처럼 다룬다(값 편집만, 삭제 불가, 설정 시 자동 연동).
const connDefs = (): BuiltinDef[] =>
  connectorKeyDefs().map((d) => ({ key: d.key, label: d.label, icon: d.icon, desc: d.desc, placeholder: d.placeholder, needs_restart: false }));
const builtinDefs = (): BuiltinDef[] => [...BUILTIN, ...connDefs()];
const isBuiltinKey = (k: string): boolean => builtinDefs().some((b) => b.key === k);

function read(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Partial<Store>;
    return { values: s.values ?? {}, custom: s.custom ?? [] };
  } catch { return { values: {}, custom: [] }; }
}
function write(s: Store): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf-8');
}
/** 항상 마스킹 — 앞 4 + 점 + 뒤 4. 짧으면 전부 가림. */
export function maskSecret(v: string): string {
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(Math.max(4, v.length));
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}
function validKeyName(k: string): boolean { return /^[A-Z][A-Z0-9_]{1,48}$/.test(k); }

export function listKeys(): ApiKeyInfo[] {
  const s = read();
  const builtin: ApiKeyInfo[] = builtinDefs().map((b) => ({ ...b, set: !!s.values[b.key], masked: maskSecret(s.values[b.key] ?? ''), builtin: true }));
  const custom: ApiKeyInfo[] = s.custom.map((c) => ({
    key: c.key, label: c.label || c.key, icon: c.icon || '🔑', desc: c.desc || '사용자 정의 키',
    placeholder: '값 입력…', needs_restart: false, set: !!s.values[c.key], masked: maskSecret(s.values[c.key] ?? ''), builtin: false,
  }));
  return [...builtin, ...custom];
}
export function setKey(key: string, value: string): { ok: boolean; error?: string } {
  const s = read();
  if (!isBuiltinKey(key) && !s.custom.some((c) => c.key === key)) return { ok: false, error: '알 수 없는 키입니다.' };
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: '값이 비었습니다.' };
  s.values[key] = value.trim();
  write(s);
  return { ok: true };
}
export function addCustom(key: string, label: string, icon: string, value: string): { ok: boolean; error?: string } {
  if (!validKeyName(key)) return { ok: false, error: '키 이름은 대문자·숫자·밑줄만 가능합니다(예: MY_API_KEY).' };
  if (isBuiltinKey(key)) return { ok: false, error: '기본 키와 중복됩니다.' };
  const s = read();
  if (!s.custom.some((c) => c.key === key)) s.custom.push({ key, label: label || key, icon: icon || '🔑', desc: '사용자 정의 키' });
  if (value && value.trim()) s.values[key] = value.trim();
  write(s);
  return { ok: true };
}
export function deleteKey(key: string): { ok: boolean; error?: string } {
  if (isBuiltinKey(key)) return { ok: false, error: '기본 키는 삭제할 수 없습니다(값만 비울 수 있음).' };
  const s = read();
  s.custom = s.custom.filter((c) => c.key !== key);
  delete s.values[key];
  write(s);
  return { ok: true };
}
/** 런타임 시크릿 조회(LLM 클라이언트 등) — 환경변수 우선, 없으면 저장소. */
export function getSecret(key: string): string | undefined {
  return process.env[key] || read().values[key] || undefined;
}
