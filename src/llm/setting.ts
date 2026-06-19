/**
 * 런타임 LLM 설정 — 웹 UI(LlmSettingsView)에서 고른 백엔드·로컬 모델을 data/llm.json 에
 * 영속하고, 이후 모든 런의 모델 배정에 반영한다.
 *
 * 기존 버그: POST /llm 이 echo 만 하고 영속·적용을 안 해서, UI 가 "디스크 저장 + 다음 런 적용"
 * 을 표방하지만 실제로는 무시됐고 모델이 항상 tierModels.standard(=gemma4:12b)로 고정됐다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface LlmSetting {
  /** 'local' | 'claude' 등 — 현재 런 엔진은 로컬(Ollama)만 구동. */
  backend: string;
  /** 사용자가 고른 로컬 모델(빈 문자열이면 자동 배정/tierModels 사용). */
  localModel: string;
}

const file = (): string => path.join(CONFIG.dataDir, 'llm.json');
let _cached: LlmSetting | null = null;

export function getLlmSetting(): LlmSetting {
  if (_cached) return _cached;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf-8')) as Partial<LlmSetting>;
    _cached = { backend: raw.backend || CONFIG.backend, localModel: raw.localModel || '' };
  } catch {
    _cached = { backend: CONFIG.backend, localModel: '' };
  }
  return _cached;
}

export function setLlmSetting(s: { backend?: string; localModel?: string }): LlmSetting {
  const cur = getLlmSetting();
  const next: LlmSetting = {
    backend: (s.backend ?? cur.backend) || CONFIG.backend,
    localModel: (s.localModel ?? cur.localModel) || '',
  };
  _cached = next;
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next), 'utf-8');
  } catch { /* 영속 실패 무해 */ }
  return next;
}

/**
 * 런의 tier 오버라이드 — 사용자가 UI 에서 로컬 모델을 골랐으면 본작업(standard·heavy)에 그 모델을
 * 쓰고, 구조적 단발 호출(micro)은 빠른 소형 모델(tierModels.micro)을 유지한다. 선택이 없으면
 * 기존 tierModels(env/기본) 그대로.
 */
export function tierOverrides(): { micro: string; standard: string; heavy: string } {
  const lm = getLlmSetting().localModel.trim();
  return lm
    ? { micro: CONFIG.tierModels.micro, standard: lm, heavy: lm }
    : CONFIG.tierModels;
}
