/**
 * 회사 정의 — CEO + 전문가 페르소나/역할/모델 tier/툴. 데이터 주도(추후 company.yaml 로딩 대체 가능).
 *
 * 모델 tier 매핑이 로컬 속도의 핵심: 마이크로(분해·배정·수렴판정)는 시스템이 micro 모델로,
 * 전문가 본작업은 standard, CEO 통합은 heavy. → llm/models.ts autoAssignModels 와 연결.
 */
import type { RoleTier } from '../llm/models';
import type { Stance } from '../events/types';

export interface RoleDef {
  id: string;
  name: string;
  title: string;
  emoji: string;
  /** 모델 선택 tier. */
  tier: RoleTier;
  stance: Stance;
  /** 말투/성격(시스템 프롬프트에 주입). */
  persona: string;
  /** 전문 영역(한 줄). */
  specialty: string;
  /** 허용 툴 id(추후 tool 게이팅). 비면 채팅 전용. */
  tools: string[];
  autonomy: number; // 0=off,1=read,2=draft(승인),3=auto
  isCritic: boolean;
  /** company.yaml 의 풍부한 시스템 프롬프트(있으면 buildSystemPrompt 가 우선 사용). */
  systemPrompt?: string;
  /** 조직 레벨(ceo|lead|member) — 프론트 표시·연출용. */
  level?: string;
  /** 소속 팀 id — 프론트 표시용. */
  team?: string | null;
}

export interface TeamDef {
  id: string;
  name: string;
  lead: RoleDef;
  members: RoleDef[];
}

export interface CompanyDef {
  name: string;
  mission: string;
  ceo: RoleDef;
  /** 평면 전문가 목록(debate 모드). teams 가 있으면 그 합집합 + 회사급 비평가. */
  specialists: RoleDef[];
  /** 조직 위계(org 모드). 없으면 debate 모드 평면 실행. */
  teams?: TeamDef[];
}

const r = (d: Partial<RoleDef> & Pick<RoleDef, 'id' | 'name' | 'title' | 'specialty'>): RoleDef => ({
  emoji: '🧑‍💼',
  tier: 'standard',
  stance: 'neutral',
  persona: '',
  tools: [],
  autonomy: 2,
  isCritic: false,
  ...d,
});

// --- 역할 정의(명명 상수 — 팀 구성에 참조) ---
const CEO = r({
  id: 'ceo', name: 'CEO', title: 'Chief Executive Agent', emoji: '🧭',
  tier: 'heavy', // 통합·종합은 가장 큰 모델
  persona: '결론을 먼저 말하고 근거로 뒷받침. 작업을 명확히 분해하고 종합 시 모순을 짚는다.',
  specialty: '오케스트레이션, 작업 분해, 종합 판단, 다음 액션 결정',
  autonomy: 3,
});
const RESEARCHER = r({
  id: 'researcher', name: 'Researcher', title: 'Trend & Data Researcher', emoji: '🔍',
  tier: 'standard', stance: 'neutral',
  persona: '근거 우선. 출처를 명시하고 불확실은 불확실로 표시.',
  specialty: '리서치, 사실 확인, 데이터 수집·요약, 경쟁/트렌드 분석',
  tools: ['wiki_query', 'wiki_ingest', 'web_search'], autonomy: 2,
});
const ANALYST = r({
  id: 'analyst', name: 'Analyst', title: 'Strategy Analyst', emoji: '📊',
  tier: 'standard', stance: 'nuanced',
  persona: '구조적으로 쪼개 트레이드오프를 표로 정리. 숫자로 말한다.',
  specialty: '전략 분석, 옵션 비교, ROI/리스크 평가, 의사결정 프레임',
  tools: ['wiki_query', 'wiki_ingest'], autonomy: 2,
});
const WRITER = r({
  id: 'writer', name: 'Writer', title: 'Copywriter', emoji: '✍️',
  tier: 'standard', stance: 'pro',
  persona: '명확하고 설득력 있게. 군더더기 없이 핵심을 글로 푼다.',
  specialty: '카피라이팅, 스크립트, 문서 초안, 후크 작성',
  tools: ['wiki_query'], autonomy: 2,
});
const CRITIC = r({
  id: 'critic', name: 'Critic', title: 'Adversarial Critic', emoji: '⚖️',
  tier: 'standard', stance: 'critic', isCritic: true,
  persona: '항상 반증을 먼저 시도. 약점·가정·반례를 들춰낸다. 근거 없는 동조 금지.',
  specialty: '비판적 검토, 가정 검증, 반례 제시, 리스크 적출',
  tools: ['wiki_query'], autonomy: 2,
});

/** 기본 회사 — 범용 리서치/전략 오피스. CEO + 2팀 + 회사급 비평가. */
export const DEFAULT_COMPANY: CompanyDef = {
  name: 'GEPA AI Office',
  mission: '사용자의 주제를 다관점으로 분석·토론·종합해 실행 가능한 결과물을 만든다.',
  ceo: CEO,
  specialists: [RESEARCHER, ANALYST, WRITER, CRITIC],
  teams: [
    { id: 'research', name: '리서치팀', lead: ANALYST, members: [RESEARCHER] },
    { id: 'content', name: '콘텐츠팀', lead: WRITER, members: [] },
  ],
};

/** id → 역할(빠른 조회). */
export function rolesById(c: CompanyDef = DEFAULT_COMPANY): Map<string, RoleDef> {
  const m = new Map<string, RoleDef>();
  m.set(c.ceo.id, c.ceo);
  for (const s of c.specialists) m.set(s.id, s);
  // 팀 리드·팀원도 포함 — directed 런이 커스텀 회사의 팀 전용 역할도 지명 가능하게.
  for (const t of c.teams ?? []) {
    m.set(t.lead.id, t.lead);
    for (const mem of t.members) m.set(mem.id, mem);
  }
  return m;
}
