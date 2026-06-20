/**
 * 회사 정의 로더 + 편집 — data/company.yaml(조직) + data/people.yaml(역할→실명) ↔ CompanyDef.
 * 없으면 assets/company 시드 복사. 역할·팀 편집은 raw YAML 문서를 수정·저장(실명은 people.yaml 분리).
 * (원본 GEPA org/company_store.py 포팅)
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG } from '../config';
import { DEFAULT_COMPANY } from './company';
import type { CompanyDef, RoleDef, TeamDef } from './company';
import type { RoleTier } from '../llm/models';
import type { Stance } from '../events/types';
import { ensureScaffold } from './workspace';

const SEED_DIR = path.resolve(process.cwd(), 'assets/company');
const MODELS = new Set(['opus', 'sonnet', 'haiku']);
// 로컬 우선 제품: UI 가 '모델' 대신 '처리 등급(tier)' 을 보낼 수 있다(micro|standard|heavy).
// YAML 일관성을 위해 등급은 대표 클라우드 모델로 저장 → 로드 시 tierFor 가 다시 tier 로 복원(round-trip).
const TIERS = new Set(['micro', 'standard', 'heavy']);
export function tierToModel(tier: string): string {
  return tier === 'heavy' ? 'opus' : tier === 'micro' ? 'haiku' : 'sonnet';
}
/** 모델명(opus|sonnet|haiku) 또는 등급(micro|standard|heavy)을 YAML 저장용 모델명으로 정규화. 유효치 않으면 null. */
export function normalizeModel(m: string | undefined): string | null {
  const v = (m || '').toLowerCase();
  if (MODELS.has(v)) return v;
  if (TIERS.has(v)) return tierToModel(v);
  return null;
}
const STANCES = new Set(['neutral', 'pro', 'con', 'critic', 'nuanced']);
const YAML_TOOLS = new Set(['wiki', 'web']);

interface YRole {
  id?: string; title?: string; level?: string; team?: string;
  focus?: string; system_prompt?: string; tools?: unknown; model?: string;
  autonomy?: number; stance?: string; is_critic?: boolean;
}
interface YTeam { id?: string; name?: string; lead?: YRole; members?: YRole[] }
interface RawDoc { company?: { name?: string }; ceo?: YRole; teams?: YTeam[] }

let _doc: RawDoc | null = null;
let _people: Record<string, string> = {};
let _cached: CompanyDef | null = null;

const dataYamlPath = (): string => path.join(CONFIG.dataDir, 'company.yaml');
const peoplePath = (): string => path.join(CONFIG.dataDir, 'people.yaml');

function ensureLoaded(): void {
  if (_doc) return;
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    if (!fs.existsSync(dataYamlPath()) && fs.existsSync(path.join(SEED_DIR, 'company.yaml'))) {
      fs.copyFileSync(path.join(SEED_DIR, 'company.yaml'), dataYamlPath());
      if (fs.existsSync(path.join(SEED_DIR, 'people.yaml'))) fs.copyFileSync(path.join(SEED_DIR, 'people.yaml'), peoplePath());
    }
    _doc = fs.existsSync(dataYamlPath()) ? (YAML.parse(fs.readFileSync(dataYamlPath(), 'utf-8')) as RawDoc) || {} : {};
    _people = {};
    if (fs.existsSync(peoplePath())) {
      const p = YAML.parse(fs.readFileSync(peoplePath(), 'utf-8')) as Record<string, unknown> | null;
      if (p) for (const [k, v] of Object.entries(p)) if (v) _people[k] = String(v);
    }
  } catch {
    _doc = {};
  }
}
function save(): void {
  if (!_doc) return;
  // 두 파일 모두 tmp 에 먼저 쓰고 원자적으로 교체 — company.yaml 저장 후 people.yaml 쓰기 전 충돌 시
  // 실명 매핑만 소실되던 비일관 상태를 방지(둘 다 rename 으로 커밋).
  const companyTmp = dataYamlPath() + '.tmp';
  const peopleTmp = peoplePath() + '.tmp';
  fs.writeFileSync(companyTmp, YAML.stringify(_doc), 'utf-8');
  fs.writeFileSync(peopleTmp, YAML.stringify(_people), 'utf-8');
  fs.renameSync(companyTmp, dataYamlPath());
  fs.renameSync(peopleTmp, peoplePath());
  _cached = null;
}

// --- YRole → RoleDef ---
export function tierFor(model: string | undefined, level: string | undefined): RoleTier {
  const m = (model || '').toLowerCase();
  if (m === 'opus') return 'heavy';
  if (m === 'haiku') return 'micro';
  if (m === 'sonnet') return 'standard';
  return level === 'ceo' || level === 'lead' ? 'heavy' : 'standard';
}
function mapTools(tools: unknown): string[] {
  const arr = Array.isArray(tools) ? tools.map(String) : [];
  const out: string[] = [];
  for (const t of arr) {
    if (t === 'wiki') out.push('wiki_query', 'wiki_ingest');
    else if (t === 'web') out.push('web_search');
    else out.push(t);
  }
  return [...new Set(out)];
}
const TEAM_EMOJI: Record<string, string> = { planning: '📊', support: '💼' };
function emojiFor(level: string | undefined, team: string | null | undefined, isCritic: boolean): string {
  if (level === 'ceo') return '🧭';
  if (isCritic) return '⚖️';
  if (level === 'lead') return '👔';
  return TEAM_EMOJI[team ?? ''] ?? '🧑‍💼';
}
// 프롬프트에 그대로 합성되는 역할 필드 살균 — company.yaml 은 웹 UI 직원 편집기로도 수정 가능
// (준-신뢰 입력)이라, 제어문자(개행·탭 제외)·널 제거 + 길이 제한으로 프롬프트 인젝션·깨짐 방어.
function sanitizeField(s: unknown, max = 4000): string {
  if (s == null) return '';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) ?? 0;
    // 제어문자 제거(탭 9·개행 10·CR 13 보존), DEL 127 제거
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue;
    if (c === 0x7f) continue;
    out += ch;
  }
  return out.slice(0, max).trim();
}
function toRole(y: YRole, fallbackLevel: string, teamId: string | null): RoleDef {
  const id = y.id ?? 'role';
  const level = y.level ?? fallbackLevel;
  const isCritic = !!y.is_critic;
  return {
    id,
    name: sanitizeField(_people[id] || y.title || id, 80),
    title: sanitizeField(y.title || id, 120),
    emoji: emojiFor(level, teamId, isCritic),
    tier: tierFor(y.model, level),
    stance: (y.stance as Stance) || 'neutral',
    persona: '',
    specialty: sanitizeField(y.focus || y.title || id, 500),
    tools: mapTools(y.tools),
    autonomy: typeof y.autonomy === 'number' ? y.autonomy : 2,
    isCritic,
    systemPrompt: y.system_prompt ? sanitizeField(y.system_prompt, 4000) : undefined,
    level,
    team: teamId,
  };
}
function buildCompanyDef(doc: RawDoc): CompanyDef {
  if (!doc.ceo) return DEFAULT_COMPANY;
  const ceo = toRole(doc.ceo, 'ceo', null);
  const teams: TeamDef[] = [];
  const specialists: RoleDef[] = [];
  for (const t of doc.teams ?? []) {
    const teamId = t.id ?? 'team';
    const lead = toRole(t.lead ?? {}, 'lead', teamId);
    const members = (t.members ?? []).map((m) => toRole(m, 'member', teamId));
    teams.push({ id: teamId, name: t.name ?? teamId, lead, members });
    specialists.push(lead, ...members);
  }
  return {
    name: doc.company?.name ?? 'GEPA AI Office',
    mission: '조직의 주제를 다관점으로 분석·토론·종합해 실행 가능한 결과물을 만든다.',
    ceo, specialists, teams,
  };
}

export function getCompany(): CompanyDef {
  ensureLoaded();
  if (_cached) return _cached;
  _cached = _doc ? buildCompanyDef(_doc) : DEFAULT_COMPANY;
  return _cached;
}
export function reloadCompany(): CompanyDef {
  _doc = null; _cached = null;
  return getCompany();
}

// --- 편집 ---
type EditResult = { ok: boolean; error?: string; [k: string]: unknown };

function findRaw(id: string): { role: YRole; container: 'ceo' | 'lead' | 'member'; team?: YTeam } | null {
  ensureLoaded();
  if (_doc?.ceo?.id === id) return { role: _doc.ceo, container: 'ceo' };
  for (const t of _doc?.teams ?? []) {
    if (t.lead?.id === id) return { role: t.lead, container: 'lead', team: t };
    const m = (t.members ?? []).find((x) => x.id === id);
    if (m) return { role: m, container: 'member', team: t };
  }
  return null;
}

export interface RolePatch {
  title?: string; system_prompt?: string; model?: string;
  stance?: string; is_critic?: boolean; tools?: string[]; name?: string;
}
export function editRole(id: string, patch: RolePatch): EditResult {
  const found = findRaw(id);
  if (!found) return { ok: false, error: '역할을 찾을 수 없습니다' };
  const r = found.role;
  if (patch.title !== undefined) r.title = patch.title.trim() || r.title;
  if (patch.system_prompt !== undefined) r.system_prompt = patch.system_prompt;
  if (patch.model !== undefined) {
    const v = normalizeModel(patch.model);
    if (!v) return { ok: false, error: '모델/등급 값 오류(opus|sonnet|haiku 또는 micro|standard|heavy)' };
    // 비표준/로컬 모델명(예: gemma3:4b) 보존: UI 는 등급(tier)만 보고 title 등만 바꿔도 model 을 무조건
    // PATCH 한다. 들어온 등급이 현재 저장값에서 유도되는 등급과 동일하면(=등급 미변경) r.model 을 건드리지
    // 않아, 사용자가 손수 넣은 커스텀 모델명이 round-trip 정규화로 silent 덮어쓰기 되는 것을 막는다.
    const level = (r as { level?: string }).level ?? found.container;
    const incomingTier = TIERS.has(patch.model.trim().toLowerCase())
      ? (patch.model.trim().toLowerCase() as RoleTier)
      : tierFor(v, level);
    if (incomingTier !== tierFor(r.model, level)) r.model = v;
  }
  if (patch.stance !== undefined) {
    if (!STANCES.has(patch.stance)) return { ok: false, error: 'stance 값 오류' };
    r.stance = patch.stance;
  }
  if (patch.is_critic !== undefined) r.is_critic = !!patch.is_critic;
  if (patch.tools !== undefined) r.tools = patch.tools.filter((t) => YAML_TOOLS.has(t));
  if (patch.name !== undefined) {
    if (patch.name.trim()) _people[id] = patch.name.trim();
    else delete _people[id];
  }
  save();
  return { ok: true };
}

export function deleteRole(id: string): EditResult {
  ensureLoaded();
  if (_doc?.ceo?.id === id) return { ok: false, error: 'CEO 는 삭제할 수 없습니다' };
  for (const t of _doc?.teams ?? []) {
    if (t.lead?.id === id) return { ok: false, error: '팀장은 팀 전체를 삭제하세요' };
    const idx = (t.members ?? []).findIndex((m) => m.id === id);
    if (idx >= 0) {
      t.members!.splice(idx, 1);
      delete _people[id];
      save();
      return { ok: true };
    }
  }
  return { ok: false, error: '역할을 찾을 수 없습니다' };
}

function uniqueTeamId(): string {
  ensureLoaded();
  const ids = new Set((_doc?.teams ?? []).map((t) => t.id));
  let n = 1;
  while (ids.has(`team${n}`)) n++;
  return `team${n}`;
}
export function addTeam(name: string): EditResult {
  ensureLoaded();
  if (!_doc) return { ok: false, error: '회사 미로드' };
  const id = uniqueTeamId();
  const leadId = `${id}_lead`;
  _doc.teams = _doc.teams ?? [];
  _doc.teams.push({
    id, name: name.trim() || id,
    lead: { id: leadId, title: `${name.trim() || id} 팀장`, level: 'lead', team: id, model: 'opus', autonomy: 3, tools: ['wiki', 'web'], system_prompt: `당신은 ${name.trim() || id}의 팀장입니다. 상위 목표를 팀원 과제로 분해·배분하고 산출물을 비판적으로 검토해 팀 결론으로 취합합니다.` },
    members: [],
  });
  save();
  return { ok: true, team_id: id };
}
export function renameTeam(tid: string, name: string): EditResult {
  ensureLoaded();
  const t = (_doc?.teams ?? []).find((x) => x.id === tid);
  if (!t) return { ok: false, error: '팀 없음' };
  t.name = name.trim() || t.name;
  save();
  return { ok: true };
}
export function deleteTeam(tid: string): EditResult {
  ensureLoaded();
  if (!_doc?.teams) return { ok: false, error: '팀 없음' };
  const idx = _doc.teams.findIndex((t) => t.id === tid);
  if (idx < 0) return { ok: false, error: '팀 없음' };
  const t = _doc.teams[idx]!;
  for (const m of [t.lead, ...(t.members ?? [])]) if (m?.id) delete _people[m.id];
  _doc.teams.splice(idx, 1);
  save();
  return { ok: true };
}

export interface MemberBody {
  title: string; system_prompt?: string; model?: string;
  stance?: string; is_critic?: boolean; tools?: string[];
}
export function addMember(tid: string, body: MemberBody): EditResult {
  ensureLoaded();
  const t = (_doc?.teams ?? []).find((x) => x.id === tid);
  if (!t) return { ok: false, error: '팀 없음' };
  t.members = t.members ?? [];
  const ids = new Set(t.members.map((m) => m.id));
  let n = 1;
  while (ids.has(`${tid}_m${n}`)) n++;
  const id = `${tid}_m${n}`;
  t.members.push({
    id, title: body.title?.trim() || `${t.name} 팀원`, level: 'member', team: tid,
    model: normalizeModel(body.model) ?? 'sonnet',
    stance: STANCES.has(body.stance ?? '') ? body.stance : 'neutral',
    is_critic: !!body.is_critic,
    tools: (body.tools ?? ['wiki', 'web']).filter((x) => YAML_TOOLS.has(x)),
    system_prompt: body.system_prompt || `당신은 ${t.name}의 담당자입니다.`,
  });
  ensureScaffold(id); // 워크스페이스 폴더 즉시 생성
  save();
  return { ok: true, member_id: id };
}
