/**
 * 수종 사전(2026-09-04) — 이미지 앵커를 LLM 기억이 아니라 표에서 가져온다.
 *
 * 경위. 1차(수종 앵커)는 종이 통째로 바뀌는 사고를 막았지만 디테일이 틀렸다 — 디렉터가 남천을
 * "손바닥 모양으로 갈라진 잎"이라고 썼는데 남천은 깃꼴겹잎이다. 2차(학명 요구)도 결국 학명 자체를
 * LLM 이 기억에서 쓰므로 같은 위험이 남는다. 이 브랜드가 다루는 수종은 26종 남짓으로 한정적이라
 * 표로 관리하는 편이 확실하다.
 *
 * 표에 있으면 표를 쓰고, 없으면 종전대로 LLM 이 쓴다(fail-open) — 표가 파이프라인을 막지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface Species {
  readonly name: string;
  readonly latin: string;
  readonly aliases?: readonly string[];
  readonly type?: string;
  readonly leaf?: string;
  readonly form?: string;
  readonly flower?: string;
  readonly fruit?: string;
  readonly note?: string;
  /** 사람이 형태 묘사를 확인했는가. 코드 동작은 안 바꾸고 표시만 한다. */
  readonly verified?: boolean;
}

let cache: Species[] | null = null;

/** data/species.yaml 로드(1회 캐시, fail-open — 파일이 없거나 깨져도 빈 목록). */
export function loadSpecies(file = path.join('data', 'species.yaml')): Species[] {
  if (cache) return cache;
  try {
    const raw = YAML.parse(fs.readFileSync(file, 'utf-8')) as { species?: Record<string, Omit<Species, 'name'>> };
    cache = Object.entries(raw?.species ?? {})
      .map(([name, v]) => ({ name, ...v }))
      .filter((s) => s.latin);
  } catch { cache = []; }
  return cache;
}

/** 테스트·재로딩용. */
export function resetSpeciesCache(): void { cache = null; }

/**
 * 키워드·주제에서 수종을 찾는다(순수 판정).
 *
 * 긴 이름을 먼저 본다 — "산수유 열매"에서 '산수유'를 찾아야지, 짧은 이름이 먼저 걸리면
 * 엉뚱한 종이 잡힌다. 별칭도 같은 규칙으로 본다("태추단감" → 감나무).
 */
export function findSpecies(text: string, list = loadSpecies()): Species | undefined {
  const t = String(text ?? '');
  if (!t.trim()) return undefined;
  const keys: Array<{ key: string; sp: Species }> = [];
  for (const sp of list) {
    keys.push({ key: sp.name, sp });
    for (const a of sp.aliases ?? []) keys.push({ key: a, sp });
  }
  keys.sort((a, b) => b.key.length - a.key.length); // 긴 이름 우선
  return keys.find((k) => t.includes(k.key))?.sp;
}

/**
 * 수종 → 이미지 앵커 문구(순수). buildSceneImagePrompt 의 subject 자리에 그대로 들어간다.
 * 형태 정보가 많을수록 길어지므로 화면에 실제로 보이는 것 위주로 추린다.
 */
export function speciesAnchor(sp: Species): string {
  const parts = [sp.type, sp.leaf, sp.form].filter(Boolean);
  return `${sp.name} — ${parts.join(', ')}`.slice(0, 200);
}

/**
 * 씬 묘사에 꽃·열매가 등장할 때만 그 정보를 덧붙인다(순수).
 * 늘 붙이면 프롬프트가 길어지고, 꽃 없는 계절 장면에 꽃이 그려질 수 있다.
 */
export function speciesSeasonalHint(sp: Species, sceneText: string): string {
  const t = String(sceneText ?? '');
  const out: string[] = [];
  if (sp.flower && /꽃|개화|봉오리|꽃눈/.test(t)) out.push(`꽃: ${sp.flower}`);
  if (sp.fruit && /열매|과실|수확|씨|종자|도토리/.test(t)) out.push(`열매: ${sp.fruit}`);
  return out.join(' · ');
}
