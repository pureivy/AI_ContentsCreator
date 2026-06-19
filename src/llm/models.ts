/**
 * 시스템 사양 감지 + RAM 예산 기반 모델 자동선택 (Connect AI system-specs.ts 벤치마킹).
 *
 * 원본 GEPA의 로컬 속도 문제 하나: 머신과 무관하게 `gemma4:12b` 고정. 16GB 머신에 큰 모델을
 * 물리면 스왑/리로드로 느려진다. 여기선 Connect AI처럼 실제 RAM을 재서 "안전 예산" 안에 드는
 * 모델만 쓰고, 역할 tier별로 우-사이징한다(마이크로 호출=가장 작은 모델, 통합=가장 큰 모델).
 */
import os from 'node:os';
import { CONFIG } from '../config';

export interface SystemSpecs {
  totalRamGB: number;
  freeRamGB: number;
  cpuModel: string;
  cpuCount: number;
  platform: NodeJS.Platform;
  arch: string;
  isAppleSilicon: boolean;
  /** LLM 로드에 안전하게 쓸 수 있는 메모리 한도(GB). Apple Silicon은 unified memory라 후하게. */
  safeModelBudgetGB: number;
  summary: string;
}

let _cached: SystemSpecs | null = null;

export function getSystemSpecs(): SystemSpecs {
  if (_cached) return _cached;
  const totalRamGB = os.totalmem() / 1024 ** 3;
  const freeRamGB = os.freemem() / 1024 ** 3;
  const cpus = os.cpus() || [];
  const cpuModel = (cpus[0]?.model || 'unknown').replace(/\s+/g, ' ').trim();
  const platform = os.platform();
  const arch = os.arch();
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64' && /Apple\s+M/i.test(cpuModel);
  const ratio = isAppleSilicon ? 0.65 : 0.5;
  const safeModelBudgetGB = Math.max(2, Math.floor(totalRamGB * ratio));
  const summary =
    `${platform === 'darwin' ? 'macOS' : platform} · ${arch}${isAppleSilicon ? ' (Apple Silicon)' : ''} · ` +
    `RAM ${totalRamGB.toFixed(0)}GB · CPU ${cpuModel.slice(0, 40)} (${cpus.length} cores) · ` +
    `모델예산 ~${safeModelBudgetGB}GB`;
  _cached = {
    totalRamGB, freeRamGB, cpuModel, cpuCount: cpus.length,
    platform, arch, isAppleSilicon, safeModelBudgetGB, summary,
  };
  return _cached;
}

/** 모델 ID에서 파라미터 수를 뽑아 4-bit GGUF 기준 메모리(GB)를 추정. 사이즈 미상이면 7B 가정. */
export function estimateModelMemoryGB(modelId: string): number {
  const id = modelId.toLowerCase();
  const m = id.match(/(\d+(?:\.\d+)?)\s*b\b/);
  const totalB = m ? parseFloat(m[1]!) : 7;
  let bytesPerParam = 0.6; // 4-bit 기본
  if (/q8|8bit|fp8/.test(id)) bytesPerParam = 1.0;
  if (/q5|5bit/.test(id)) bytesPerParam = 0.7;
  if (/q6|6bit/.test(id)) bytesPerParam = 0.8;
  if (/fp16|f16|bf16/.test(id)) bytesPerParam = 2.0;
  return totalB * bytesPerParam + 1.0; // +1GB 런타임/KV 오버헤드
}

/** 모델 ID에서 파라미터(B) 추출 — 미상이면 7. */
export function paramsB(modelId: string): number {
  const m = modelId.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
  return m ? parseFloat(m[1]!) : 7;
}

export interface InstalledModel {
  name: string;
  /** /api/tags 의 size(byte) → GB. 0이면 미상(추정 사용). */
  sizeGB: number;
}

export type RoleTier = 'micro' | 'standard' | 'heavy';

export interface ModelAssignment {
  micro: string;    // 분해·배정·수렴판정·분류·리플렉트 등 구조적 단발 호출
  standard: string; // 전문가/팀원 본작업
  heavy: string;    // CEO 통합·종합(긴 산출물)
  reason: string;
}

/** 한 모델의 "실효 메모리(GB)" — 실제 디스크 사이즈 우선, 없으면 파라미터 추정. */
function effectiveGB(m: InstalledModel): number {
  return m.sizeGB > 0 ? m.sizeGB : estimateModelMemoryGB(m.name);
}

/** 명백한 비채팅/별칭 후보 제외(임베딩·정체불명 별칭). 보수적으로 최소만 거른다. */
function isUsable(name: string): boolean {
  const n = name.toLowerCase();
  if (/embed|bge|nomic-embed|all-minilm/.test(n)) return false;
  return true;
}

/**
 * 설치된 모델을 RAM 예산 안에서 micro/standard/heavy 로 배정.
 *  - 예산 초과 모델은 후보에서 제외(스왑/리로드 회피).
 *  - micro: 예산 내 가장 작은 모델(가능하면 ≤4B) — 마이크로 호출 지연 최소.
 *  - heavy: 예산 내 가장 큰 모델 — 통합 품질.
 *  - standard: 그 사이(없으면 heavy 와 동일).
 */
export function autoAssignModels(
  installed: InstalledModel[],
  specs = getSystemSpecs(),
  overrides = CONFIG.tierModels,
): ModelAssignment {
  const budget = specs.safeModelBudgetGB;
  const usableRaw = installed.filter((m) => isUsable(m.name));
  // 별칭/태그 중복 제거 — 동일 (사이즈, 파라미터)=동일 모델로 간주, 가장 짧은 이름 채택.
  const seen = new Map<string, InstalledModel>();
  for (const m of usableRaw.slice().sort((a, b) => a.name.length - b.name.length)) {
    const key = `${Math.round(effectiveGB(m) * 10) / 10}|${paramsB(m.name)}`;
    if (!seen.has(key)) seen.set(key, m);
  }
  const usable = [...seen.values()];
  const fitting = usable
    .filter((m) => effectiveGB(m) <= budget + 0.5) // 살짝 여유
    .sort((a, b) => effectiveGB(a) - effectiveGB(b));

  if (fitting.length === 0) {
    // 전부 예산 초과 → 그래도 가장 작은 걸 쓴다(돌긴 돌게).
    const fallback = (usable.length ? usable : installed)
      .slice()
      .sort((a, b) => effectiveGB(a) - effectiveGB(b))[0]?.name || 'gemma3:4b';
    return { micro: fallback, standard: fallback, heavy: fallback, reason: `예산(${budget}GB) 내 모델 없음 → 최소 모델 ${fallback} 단일 사용` };
  }

  const smallest = fitting[0]!;
  const largest = fitting[fitting.length - 1]!;
  // micro: ≤4B 중 가장 큰 것(너무 작으면 품질↓) 우선, 없으면 최소.
  const microCand = fitting.filter((m) => paramsB(m.name) <= 4.5);
  const micro = (microCand[microCand.length - 1] ?? smallest).name;
  const heavy = largest.name;
  const mid = fitting[Math.floor((fitting.length - 1) / 2)] ?? largest;
  const standard = mid.name;

  // 등급별 명시 지정(env/config) 우선 — 단, 실제 설치된 모델일 때만. 아니면 자동 배정 폴백.
  const installedNames = new Set(installed.map((m) => m.name));
  const pick = (ov: string, auto: string): string => (ov && installedNames.has(ov) ? ov : auto);
  const fMicro = pick(overrides.micro, micro);
  const fStd = pick(overrides.standard, standard);
  const fHeavy = pick(overrides.heavy, heavy);
  const overridden = fMicro !== micro || fStd !== standard || fHeavy !== heavy;
  return {
    micro: fMicro,
    standard: fStd,
    heavy: fHeavy,
    reason: `예산 ${budget}GB · 후보 ${fitting.length}종 → micro=${fMicro} standard=${fStd} heavy=${fHeavy}${overridden ? ' (등급별 지정 적용)' : ''}`,
  };
}

/** 역할 tier → 배정된 모델 ID. */
export function modelForTier(assign: ModelAssignment, tier: RoleTier): string {
  return tier === 'micro' ? assign.micro : tier === 'heavy' ? assign.heavy : assign.standard;
}
