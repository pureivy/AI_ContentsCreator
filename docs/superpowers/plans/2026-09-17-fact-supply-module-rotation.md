# 글감 공급·모듈 로테이션·읽을 거리 축 — 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 블로그 글이 수종만 바뀐 채 같은 모듈로 반복되는 것을 끊는다 — 집필 전에 수종 고유 사실(재배+이야기)을 코드가 모아 주고, 부족하면 자율 런은 주제를 바꿔 재시도하며, 최근 5편에 쓴 내용 모듈은 금지하고, 이야기 축(전설·꽃말·유래·역사·문학·명소)을 주제 선정에 넣는다.

**Architecture:** ① `src/content/factSupply.ts`가 결정적 질의 → 지식백과·DDG 검색 → LLM 추출 1회로 사실을 모아 브리프 끝에 붙이고, 기준 미달이면 `FactStarvedError`로 런을 끝내 main.ts가 piece를 `error`+`factStarved`로 기록하고 다음 틱을 즉시 띄운다. ② `src/content/contentModules.ts`가 최근 초안에서 모듈을 결정적으로 판정해 작가 프롬프트에 금지 블록을 넣고, `buildGenreGuide`의 "다른 축 섹션 추가" 문장을 뺀다. ③ `topicThemes`에 이야기 5축을 더하고 두뇌 프롬프트·앵커 게이트를 보강한다.

**Tech Stack:** TypeScript(Node 20, tsx), Hono 서버, vitest, YAML 브랜드 설정, 네이버 검색 API(encyc), DuckDuckGo HTML 검색.

**Spec:** `docs/superpowers/specs/2026-09-17-fact-supply-module-rotation-design.md`

## Global Constraints

- 모든 새 게이트·단계는 킬스위치를 갖고, off 면 **종전 동작과 동일**해야 한다: `FACT_SUPPLY`, `MODULE_ROTATION`.
- 기본값(스펙 §2-6·§3-5): `FACT_MIN_SPECIFIC=5`, `FACT_SUPPLY_RETRY=2`, `FACT_STARVED_DAYS=14`, `MODULE_RECENT_PIECES=5`.
- 사용자가 직접 띄운 런(`piece.userTriggered` 또는 `auto` 아님)은 **절대 사실 부족으로 보류하지 않는다**.
- 커넥터·LLM 실패는 fail-open(종전 집필). "검색해서 정말 안 나온 경우"만 부족이다.
- 순수 함수는 LLM·네트워크 없이 테스트한다. 파일 삭제는 `trash`(rm 금지), `mv`는 `-n`.
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir`.
- 서버는 LaunchAgent(`com.gepa.ai-contents-studio`)가 띄운다. 코드 반영은 마지막 태스크에서 `launchctl kickstart -k gui/$(id -u)/com.gepa.ai-contents-studio`.
- 스펙 §2-2와 다른 점 하나: 지식백과 커넥터는 `registerConnector`로 **등록하지 않는다**(같은 키의 시크릿 카드가 UI에 중복되고, 이 도구를 가진 역할도 없다). 코드가 직접 호출하는 모듈로만 둔다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/grounding/naver_encyc.ts` (신규) | 네이버 지식백과 검색 1함수 + 응답 파서(순수) |
| `src/content/factSupply.ts` (신규) | 사실 공급: 대상·질의(순수) → 검색 수집 → LLM 추출 → ref 검증(순수) → 블록(순수) |
| `src/sessions/digest.ts` | `writeFactSupply/readFactSupply` |
| `src/config.ts` | 6개 설정 키 |
| `src/orchestrator/run.ts` | `RunOptions.factStrict` |
| `src/orchestrator/org.ts` | `FactStarvedError`, 브리프 훅, 작가 지침 한 줄, 모듈 금지 주입, `buildGenreGuide` 정정 |
| `src/content/pieces.ts` | `Piece.factStarved`, `markFactStarved` |
| `src/server/main.ts` | `factStrict` 계산, 사실 부족 catch, 재시도 |
| `src/autonomy/scheduler.ts` | 사실 부족 수종 게이트, 두뇌 프롬프트, 각도 메뉴, `lacksSpeciesAnchor` |
| `src/content/contentModules.ts` (신규) | 모듈 판정·금지 목록·블록(순수) + 최근 초안 리더 |
| `src/content/priorCoverage.ts` | `blogBodyOf` export |
| `src/content/brand.ts` | `contentModules` 타입·로더, `topicThemes` 상한 32 |
| `data/brands/bionditree.yaml` | `contentModules` 9개, `topicThemes` +5 |
| `scripts/rotation_report.ts` | 모듈 분포·이야기 축 비율 표 |
| `.env` | 새 키 주석 |

---

### Task 1: 네이버 지식백과 커넥터

**Files:**
- Create: `src/grounding/naver_encyc.ts`
- Test: `src/grounding/naver_encyc.test.ts`

**Interfaces:**
- Consumes: `getSecret`(`src/secrets/store`), `fetchTimeout`(`src/util/fetch`), `stripTags`(`src/grounding/naver_common`)
- Produces: `export interface EncycResult { title: string; link: string; description: string }`,
  `export function parseEncycItems(json: unknown, limit?: number): EncycResult[]`,
  `export function naverEncycEnabled(): boolean`,
  `export async function naverEncyc(query: string, display?: number, signal?: AbortSignal): Promise<EncycResult[]>`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/grounding/naver_encyc.test.ts
import { describe, it, expect } from 'vitest';
import { parseEncycItems } from './naver_encyc';

describe('parseEncycItems — 지식백과 응답 파서(순수)', () => {
  it('title/description 의 <b> 태그를 벗기고 link 를 그대로 둔다', () => {
    const json = { items: [
      { title: '<b>음나무</b>', link: 'https://terms.naver.com/entry.naver?docId=1', description: '두릅나무과의 <b>낙엽</b> 교목' },
      { title: '엄나무', link: 'https://terms.naver.com/entry.naver?docId=2', description: '음나무의 다른 이름' },
    ] };
    expect(parseEncycItems(json)).toEqual([
      { title: '음나무', link: 'https://terms.naver.com/entry.naver?docId=1', description: '두릅나무과의 낙엽 교목' },
      { title: '엄나무', link: 'https://terms.naver.com/entry.naver?docId=2', description: '음나무의 다른 이름' },
    ]);
  });
  it('link 없는 항목은 버리고 limit 로 자른다', () => {
    const json = { items: [{ title: 'a', description: 'x' }, { title: 'b', link: 'https://b', description: 'y' }, { title: 'c', link: 'https://c', description: 'z' }] };
    expect(parseEncycItems(json, 1)).toEqual([{ title: 'b', link: 'https://b', description: 'y' }]);
  });
  it('items 가 없거나 형식이 다르면 빈 배열', () => {
    expect(parseEncycItems(null)).toEqual([]);
    expect(parseEncycItems({ items: 'x' })).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/grounding/naver_encyc.test.ts`
Expected: FAIL — `Cannot find module './naver_encyc'`

- [ ] **Step 3: 구현**

```ts
// src/grounding/naver_encyc.ts
/**
 * 네이버 검색 API(지식백과) 커넥터 — NAVER_CLIENT_ID + NAVER_CLIENT_SECRET(naver_search 와 같은 키).
 * 용도: 사실 공급(factSupply)의 1차 출처 — 두산백과·국가생물종지식정보 등 수종 고유 사실이 여기서 나온다.
 * 그라운딩 레지스트리에 등록하지 않는다(같은 키 카드가 UI에 중복되고 이 도구를 가진 역할도 없다) —
 * 코드가 직접 부르는 함수 하나다. 실패·미설정은 [] (fail-open).
 */
import { getSecret } from '../secrets/store';
import { fetchTimeout } from '../util/fetch';
import { stripTags } from './naver_common';

const CID = 'NAVER_CLIENT_ID';
const CSEC = 'NAVER_CLIENT_SECRET';

export interface EncycResult { title: string; link: string; description: string }

export function naverEncycEnabled(): boolean { return !!getSecret(CID) && !!getSecret(CSEC); }

/** 응답 파서(순수) — link 없는 항목은 버린다(출처 URL 이 곧 채택 조건이라 링크 없는 사실은 쓸모가 없다). */
export function parseEncycItems(json: unknown, limit = 5): EncycResult[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: EncycResult[] = [];
  for (const it of items) {
    const o = it as { title?: unknown; link?: unknown; description?: unknown } | null;
    const link = typeof o?.link === 'string' ? o.link.trim() : '';
    if (!link) continue;
    out.push({ title: stripTags(String(o?.title ?? '')), link, description: stripTags(String(o?.description ?? '')) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function naverEncyc(query: string, display = 5, signal?: AbortSignal): Promise<EncycResult[]> {
  const q = query.trim();
  if (!q || !naverEncycEnabled()) return [];
  try {
    const url = `https://openapi.naver.com/v1/search/encyc.json?query=${encodeURIComponent(q)}&display=${display}`;
    const r = await fetchTimeout(url, {
      headers: { 'X-Naver-Client-Id': getSecret(CID)!, 'X-Naver-Client-Secret': getSecret(CSEC)! },
    }, signal);
    if (!r.ok) return [];
    return parseEncycItems(await r.json(), display);
  } catch { return []; }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/grounding/naver_encyc.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/grounding/naver_encyc.ts src/grounding/naver_encyc.test.ts
git commit -m "feat(grounding): 네이버 지식백과 커넥터 — 사실 공급의 1차 출처

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 2: 사실 공급 순수 함수 — 대상·질의·ref 검증·고유 판정·블록

**Files:**
- Create: `src/content/factSupply.ts`
- Test: `src/content/factSupply.test.ts`

**Interfaces:**
- Consumes: `findSpeciesLoose`(`src/content/species`) — `(text: string) => Species | undefined`, `Species.name`, `Species.aliases?`
- Produces (이후 태스크가 쓰는 이름):
  ```ts
  export type FactKind = 'cultivation' | 'lore';
  export interface SearchHit { title: string; url: string; snippet: string }
  export interface SuppliedFact { text: string; kind: FactKind; source: string; url: string; specific: boolean }
  export interface FactSupplyResult {
    status: 'ok' | 'skipped' | 'error'; subject: string; species?: string; queries: string[];
    resultCount: number; facts: SuppliedFact[]; specificCount: number; error?: string; checkedTs: string;
  }
  export interface RawFact { text?: unknown; ref?: unknown; kind?: unknown; specific?: unknown }
  export const FACT_SUPPLY_HEADER = '## 재배·이야기 사실 조사(자동 수집)';
  export function factSubjectOf(topic: string, keyword?: string): { subject: string; species?: string }
  export function factQueriesFor(subject: string, species?: string): string[]
  export function isSpecificFact(text: string, sourceTitle: string, species: string | undefined, llmSpecific: boolean, aliases?: readonly string[]): boolean
  export function attachRefs(raw: unknown, hits: SearchHit[], species?: string, aliases?: readonly string[], max?: number): SuppliedFact[]
  export function factSupplyBlock(r: FactSupplyResult): string
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/content/factSupply.test.ts
import { describe, it, expect } from 'vitest';
import { factSubjectOf, factQueriesFor, isSpecificFact, attachRefs, factSupplyBlock, FACT_SUPPLY_HEADER } from './factSupply';
import type { SearchHit, FactSupplyResult } from './factSupply';

describe('factSubjectOf — 사실 수집 대상', () => {
  it('수종이 잡히면 수종명이 대상', () => {
    expect(factSubjectOf('음나무가 잘 자라는 지역, 중부·남부 다르게 심는 법', '음나무')).toEqual({ subject: '음나무', species: '음나무' });
    expect(factSubjectOf('엄나무 묘목, 뿌리목부터 확인하세요')).toEqual({ subject: '음나무', species: '음나무' }); // 별칭
  });
  it('수종이 없으면 keyword(3어절 이하) → 없으면 제목 첫 어절', () => {
    expect(factSubjectOf('나무 상처 치료제, 바르면 안 되는 5가지 자리', '나무 상처 치료제')).toEqual({ subject: '나무 상처 치료제' });
    expect(factSubjectOf('상토 배양토 차이, 구덩이로 포대 수 계산', '상토 배양토 차이 구덩이 포대')).toEqual({ subject: '상토' });
    expect(factSubjectOf('상토 배양토 차이')).toEqual({ subject: '상토' });
  });
});

describe('factQueriesFor — 결정적 질의', () => {
  it('수종이면 재배 5 + 이야기 3 = 8개', () => {
    const q = factQueriesFor('음나무', '음나무');
    expect(q).toHaveLength(8);
    expect(q).toContain('음나무 재배');
    expect(q).toContain('음나무 전설 설화 유래');
    expect(q).toContain('음나무 꽃말 상징');
  });
  it('수종이 없으면 재배·특성·주의 3개만', () => {
    expect(factQueriesFor('상토')).toEqual(['상토 재배', '상토 특성 자생지', '상토 주의 문제']);
  });
});

describe('isSpecificFact — 수종 고유 판정', () => {
  it('수종이 있으면 텍스트나 출처 제목에 수종명·별칭이 있어야 고유', () => {
    expect(isSpecificFact('음나무는 두릅나무과 낙엽교목이다', '두산백과', '음나무', true)).toBe(true);
    expect(isSpecificFact('어린 순을 개두릅이라 하여 먹는다', '엄나무 - 두산백과', '음나무', true, ['엄나무'])).toBe(true);
    expect(isSpecificFact('물 빠짐이 좋은 흙을 좋아한다', '나무 심기 요령', '음나무', true)).toBe(false); // LLM 이 true 라 해도 수종명 없음
  });
  it('수종이 없는 주제는 LLM 태그를 따른다', () => {
    expect(isSpecificFact('상토는 펄라이트·피트모스가 섞인 인공 배양토다', '상토 - 두산백과', undefined, true)).toBe(true);
    expect(isSpecificFact('흙은 배수가 중요하다', '원예 기초', undefined, false)).toBe(false);
  });
});

describe('attachRefs — ref 검증·URL 부착', () => {
  const hits: SearchHit[] = [
    { title: '음나무 - 두산백과', url: 'https://terms.naver.com/1', snippet: '...' },
    { title: '엄나무 재배법', url: 'https://example.com/a', snippet: '...' },
  ];
  it('유효한 ref 만 남기고 URL·출처명을 붙인다, 범위 밖·없음은 버린다', () => {
    const raw = { facts: [
      { text: '음나무는 전국 산지에 자생한다', ref: 1, kind: 'cultivation', specific: true },
      { text: '음나무 새순은 개두릅이라 부른다', ref: 2, kind: 'lore', specific: true },
      { text: '지어낸 사실', ref: 9, kind: 'lore', specific: true },
      { text: 'ref 없음', kind: 'lore', specific: true },
    ] };
    const out = attachRefs(raw, hits, '음나무');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ text: '음나무는 전국 산지에 자생한다', kind: 'cultivation', source: '음나무 - 두산백과', url: 'https://terms.naver.com/1', specific: true });
    expect(out[1]!.url).toBe('https://example.com/a');
  });
  it('kind 가 이상하면 cultivation, specific 은 isSpecificFact 로 재판정, 같은 문장은 1번만', () => {
    const raw = { facts: [
      { text: '물 빠짐이 좋아야 한다', ref: 2, kind: 'weird', specific: true },
      { text: '물 빠짐이 좋아야 한다', ref: 2, kind: 'lore', specific: true },
    ] };
    const out = attachRefs(raw, hits, '음나무');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('cultivation');
    expect(out[0]!.specific).toBe(false);
  });
  it('형식이 아니면 빈 배열', () => {
    expect(attachRefs(null, hits)).toEqual([]);
    expect(attachRefs({ facts: 'x' }, hits)).toEqual([]);
  });
});

describe('factSupplyBlock — 브리프에 붙는 블록', () => {
  it('[재배]/[이야기] 접두와 (근거: 출처, URL) 꼴, 고유 사실만', () => {
    const r: FactSupplyResult = {
      status: 'ok', subject: '음나무', species: '음나무', queries: [], resultCount: 3, specificCount: 2, checkedTs: 't',
      facts: [
        { text: '음나무는 전국 산지에 자생한다', kind: 'cultivation', source: '두산백과', url: 'https://t/1', specific: true },
        { text: '음나무 가시로 잡귀를 막는다는 풍습이 있다', kind: 'lore', source: '한국민속대백과', url: 'https://t/2', specific: true },
        { text: '물 빠짐이 좋아야 한다', kind: 'cultivation', source: 'x', url: 'https://t/3', specific: false },
      ],
    };
    const b = factSupplyBlock(r);
    expect(b.startsWith(FACT_SUPPLY_HEADER)).toBe(true);
    expect(b).toContain('- [재배] 음나무는 전국 산지에 자생한다 (근거: 두산백과, https://t/1)');
    expect(b).toContain('- [이야기] 음나무 가시로 잡귀를 막는다는 풍습이 있다 (근거: 한국민속대백과, https://t/2)');
    expect(b).not.toContain('물 빠짐');
  });
  it('고유 사실이 0이면 빈 문자열', () => {
    expect(factSupplyBlock({ status: 'ok', subject: 'x', queries: [], resultCount: 0, facts: [], specificCount: 0, checkedTs: 't' })).toBe('');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/content/factSupply.test.ts`
Expected: FAIL — `Cannot find module './factSupply'`

- [ ] **Step 3: 구현(순수 부분)**

```ts
// src/content/factSupply.ts
/**
 * 사실 공급(2026-09-17) — 집필 전에 수종(또는 소재)에 고유한 사실을 코드가 모아 브리프 끝에 붙인다.
 *
 * 왜: 리서치팀은 키워드팀이라(검색량·SERP) 사실 카드에 식물 사실이 평균 3건, 9편은 0건이었다(9/1~9/17
 * 37편 실측). 작가 지침이 "브리프에 없는 사실은 일반론으로만"이라 2,000자를 어느 나무에나 맞는
 * 일반론으로 채웠고, 그게 "수종만 바뀐 같은 글"의 뿌리다.
 *
 * 원칙: 코드가 검색하고 LLM 은 추출만 한다. 질의는 결정적, 출처 URL 은 검색 결과에 실제로 있던 것만
 * (ref 번호로 대조) — 날조 URL 이 결정적으로 막힌다. "어느 나무에나 맞는 말"은 고유 사실이 아니다.
 */
import { findSpeciesLoose } from './species';

export type FactKind = 'cultivation' | 'lore';
export interface SearchHit { title: string; url: string; snippet: string }
export interface SuppliedFact { text: string; kind: FactKind; source: string; url: string; specific: boolean }
export interface FactSupplyResult {
  status: 'ok' | 'skipped' | 'error';
  subject: string;
  species?: string;
  queries: string[];
  resultCount: number;
  facts: SuppliedFact[];
  /** specific && URL 유효 — 임계 판정의 기준. */
  specificCount: number;
  error?: string;
  checkedTs: string;
}
export interface RawFact { text?: unknown; ref?: unknown; kind?: unknown; specific?: unknown }

export const FACT_SUPPLY_HEADER = '## 재배·이야기 사실 조사(자동 수집)';

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');

/** 수집 대상 — 수종 사전 적중 → 키워드(3어절 이하) → 제목 첫 어절. */
export function factSubjectOf(topic: string, keyword?: string): { subject: string; species?: string } {
  const sp = findSpeciesLoose(`${topic} ${keyword ?? ''}`);
  if (sp) return { subject: sp.name, species: sp.name };
  const kw = (keyword ?? '').trim();
  if (kw && kw.split(/\s+/).length <= 3) return { subject: kw };
  const first = topic.trim().split(/[\s,·]+/)[0] ?? '';
  return { subject: first || kw || topic.trim() };
}

/** 결정적 질의 — 수종이면 재배 5 + 이야기 3, 아니면 재배·특성·주의 3. */
export function factQueriesFor(subject: string, species?: string): string[] {
  const s = subject.trim();
  const base = [`${s} 재배`, `${s} 특성 자생지`];
  if (!species) return [...base, `${s} 주의 문제`];
  return [
    ...base,
    `${s} 심는 시기 토양`, `${s} 전정 시기`, `${s} 병해충`,
    `${s} 전설 설화 유래`, `${s} 꽃말 상징`, `${s} 쓰임 역사`,
  ];
}

/** 고유 판정 — 수종이 있으면 텍스트·출처 제목에 수종명(별칭 포함)이 있어야 한다. LLM 태그는 보조. */
export function isSpecificFact(
  text: string, sourceTitle: string, species: string | undefined, llmSpecific: boolean, aliases: readonly string[] = [],
): boolean {
  if (!species) return llmSpecific;
  const hay = compact(`${text} ${sourceTitle}`);
  return [species, ...aliases].some((n) => n && hay.includes(compact(n)));
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

/** LLM 응답 {facts:[{text, ref, kind, specific}]} 를 검색 결과와 대조 — ref 가 결과 번호(1-based)여야 산다. */
export function attachRefs(
  raw: unknown, hits: SearchHit[], species?: string, aliases: readonly string[] = [], max = 20,
): SuppliedFact[] {
  const list = (raw as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(list)) return [];
  const out: SuppliedFact[] = [];
  const seen = new Set<string>();
  for (const f of list as RawFact[]) {
    const text = typeof f?.text === 'string' ? f.text.trim().replace(/^[-•*]\s+/, '') : '';
    const ref = typeof f?.ref === 'number' ? f.ref : Number(f?.ref);
    if (!text || !Number.isInteger(ref) || ref < 1 || ref > hits.length) continue;
    const key = compact(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = hits[ref - 1]!;
    const kind: FactKind = f?.kind === 'lore' ? 'lore' : 'cultivation';
    out.push({
      text, kind, url: hit.url, source: hit.title.trim() || hostOf(hit.url),
      specific: isSpecificFact(text, hit.title, species, f?.specific === true, aliases),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 브리프 끝에 붙는 블록 — 고유 사실만, extractFactCard 가 URL 붙은 줄을 그대로 집어간다. */
export function factSupplyBlock(r: FactSupplyResult): string {
  const lines = r.facts.filter((f) => f.specific)
    .map((f) => `- [${f.kind === 'lore' ? '이야기' : '재배'}] ${f.text} (근거: ${f.source}, ${f.url})`);
  if (!lines.length) return '';
  return [FACT_SUPPLY_HEADER, ...lines].join('\n');
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/content/factSupply.test.ts`
Expected: PASS (11 tests). `factSubjectOf` 테스트는 실제 `data/species.yaml`을 읽는다(음나무·엄나무 별칭이 등재돼 있다).

- [ ] **Step 5: 커밋**

```bash
git add src/content/factSupply.ts src/content/factSupply.test.ts
git commit -m "feat(content): 사실 공급 순수 함수 — 대상·결정적 질의·ref 검증·고유 판정·브리프 블록

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 3: 사실 공급 오케스트레이션 + 세션 파일 + 설정

**Files:**
- Modify: `src/content/factSupply.ts` (수집·추출·`supplyFacts` 추가)
- Modify: `src/sessions/digest.ts` (`writeFactSupply/readFactSupply`, `writeFactCard` 옆)
- Modify: `src/config.ts` (인터페이스 `factGate` 근처 + 값 `factGate:` 근처)
- Test: `src/content/factSupply.test.ts`, `src/sessions/digest.test.ts`

**Interfaces:**
- Consumes: `naverEncyc`(Task 1), `webSearch(query, limit, signal): Promise<WebResult[]>`(`src/tools/web_search`, `WebResult {title,url,snippet}`), `microJSON<T>(model, system, user, {maxOutputTokens, signal})`(`src/orchestrator/agent`)
- Produces:
  ```ts
  export interface FactSupplyDeps {
    encyc: (q: string, display: number, signal?: AbortSignal) => Promise<Array<{ title: string; link: string; description: string }>>;
    web: (q: string, limit: number, signal?: AbortSignal) => Promise<Array<{ title: string; url: string; snippet: string }>>;
    llm: (model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal }) => Promise<unknown>;
  }
  export async function collectSearchResults(queries: string[], deps: FactSupplyDeps, signal?: AbortSignal, cap?: number): Promise<SearchHit[]>
  export async function supplyFacts(a: { topic: string; keyword?: string; model: string; signal?: AbortSignal }, deps?: FactSupplyDeps): Promise<FactSupplyResult>
  // digest.ts
  export function writeFactSupply(runId: string, r: FactSupplyResult): void
  export function readFactSupply(runId: string): FactSupplyResult | null
  // config
  CONFIG.factSupply: boolean; CONFIG.factMinSpecific: number; CONFIG.factSupplyRetry: number; CONFIG.factStarvedDays: number
  ```

- [ ] **Step 1: 실패하는 테스트 추가(factSupply.test.ts 끝에)**

```ts
import { collectSearchResults, supplyFacts } from './factSupply';
import type { FactSupplyDeps } from './factSupply';

describe('collectSearchResults / supplyFacts — 수집·추출(의존성 주입)', () => {
  const deps = (overrides: Partial<FactSupplyDeps> = {}): FactSupplyDeps => ({
    encyc: async (q) => (q.includes('재배') ? [{ title: '음나무 - 두산백과', link: 'https://terms/1', description: '전국 산지 자생' }] : []),
    web: async (q) => (q.includes('전설') ? [{ title: '음나무 민속', url: 'https://web/1', snippet: '가시로 잡귀를 막는다' }, { title: '음나무 - 두산백과', url: 'https://terms/1', snippet: '중복' }] : []),
    llm: async () => ({ facts: [
      { text: '음나무는 전국 산지에 자생한다', ref: 1, kind: 'cultivation', specific: true },
      { text: '음나무 가시로 잡귀를 막는다는 풍습이 있다', ref: 2, kind: 'lore', specific: true },
    ] }),
    ...overrides,
  });
  it('질의마다 백과+웹을 모으고 URL 로 중복 제거, 번호는 1부터', async () => {
    const hits = await collectSearchResults(['음나무 재배', '음나무 전설 설화 유래'], deps());
    expect(hits.map((h) => h.url)).toEqual(['https://terms/1', 'https://web/1']);
  });
  it('supplyFacts — ok 상태와 고유 사실 수', async () => {
    const r = await supplyFacts({ topic: '음나무가 잘 자라는 자리', model: 'm' }, deps());
    expect(r.status).toBe('ok');
    expect(r.species).toBe('음나무');
    expect(r.queries).toHaveLength(8);
    expect(r.resultCount).toBe(2);
    expect(r.specificCount).toBe(2);
    expect(r.facts[1]!.url).toBe('https://web/1');
  });
  it('검색 결과가 0이면 ok·specificCount 0 (LLM 호출 안 함)', async () => {
    let called = 0;
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ encyc: async () => [], web: async () => [], llm: async () => { called++; return null; } }));
    expect(r.status).toBe('ok');
    expect(r.specificCount).toBe(0);
    expect(called).toBe(0);
  });
  it('LLM 이 null 을 주면 error (보류 사유가 아니다)', async () => {
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ llm: async () => null }));
    expect(r.status).toBe('error');
    expect(r.facts).toEqual([]);
  });
  it('커넥터가 던져도 error 로 삼킨다', async () => {
    const r = await supplyFacts({ topic: '음나무 자리', model: 'm' }, deps({ encyc: async () => { throw new Error('boom'); } }));
    expect(['ok', 'error']).toContain(r.status); // web 만으로 진행되면 ok, 둘 다 죽으면 error — 예외는 밖으로 안 나간다
  });
});
```

digest.test.ts 끝에:

```ts
  it('사실 공급 결과를 JSON 으로 쓰고 읽는다(없으면 null)', async () => {
    const { writeFactSupply, readFactSupply } = await import('./digest');
    expect(readFactSupply('r9')).toBeNull();
    const r = { status: 'ok' as const, subject: '음나무', species: '음나무', queries: ['음나무 재배'], resultCount: 1, facts: [], specificCount: 0, checkedTs: 't' };
    writeFactSupply('r9', r);
    expect(readFactSupply('r9')).toEqual(r);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/content/factSupply.test.ts src/sessions/digest.test.ts`
Expected: FAIL — `collectSearchResults is not a function` / `writeFactSupply is not a function`

- [ ] **Step 3: 구현**

`src/content/factSupply.ts` 끝에 추가:

```ts
import { naverEncyc } from '../grounding/naver_encyc';
import { webSearch } from '../tools/web_search';
import { microJSON } from '../orchestrator/agent';

export interface FactSupplyDeps {
  encyc: (q: string, display: number, signal?: AbortSignal) => Promise<Array<{ title: string; link: string; description: string }>>;
  web: (q: string, limit: number, signal?: AbortSignal) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  llm: (model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal }) => Promise<unknown>;
}
const DEFAULT_DEPS: FactSupplyDeps = {
  encyc: (q, display, signal) => naverEncyc(q, display, signal),
  web: (q, limit, signal) => webSearch(q, limit, signal),
  llm: (model, system, user, opts) => microJSON(model, system, user, opts),
};

/** 질의마다 백과 5 + 웹 5, URL 로 중복 제거, cap 까지. 개별 커넥터 실패는 그 질의만 비운다. */
export async function collectSearchResults(queries: string[], deps: FactSupplyDeps, signal?: AbortSignal, cap = 40): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit): void => {
    const u = h.url.trim();
    if (!u || seen.has(u) || out.length >= cap) return;
    seen.add(u);
    out.push({ title: h.title.trim(), url: u, snippet: h.snippet.trim() });
  };
  for (const q of queries) {
    if (signal?.aborted) break;
    const [enc, web] = await Promise.all([
      deps.encyc(q, 5, signal).catch(() => []),
      deps.web(q, 5, signal).catch(() => []),
    ]);
    for (const e of enc) push({ title: e.title, url: e.link, snippet: e.description });
    for (const w of web) push({ title: w.title, url: w.url, snippet: w.snippet });
  }
  return out;
}

const SYS = '너는 원예 콘텐츠의 사실 수집 보조자다. 검색 결과에 적힌 내용만 옮기고, 요청된 JSON 스키마만 출력한다.';

export async function supplyFacts(
  a: { topic: string; keyword?: string; model: string; signal?: AbortSignal }, deps: FactSupplyDeps = DEFAULT_DEPS,
): Promise<FactSupplyResult> {
  const checkedTs = new Date().toISOString();
  const { subject, species } = factSubjectOf(a.topic, a.keyword);
  const queries = factQueriesFor(subject, species);
  const base = { subject, ...(species ? { species } : {}), queries, checkedTs };
  try {
    const hits = await collectSearchResults(queries, deps, a.signal);
    if (!hits.length) return { ...base, status: 'ok', resultCount: 0, facts: [], specificCount: 0 };
    const numbered = hits.map((h, i) => `${i + 1}. [${h.title}] ${h.snippet} (${h.url})`).join('\n');
    const user = [
      `대상: "${subject}"${species ? '(수종)' : '(소재)'}. 아래 검색 결과에서 **${subject}에만 해당하는** 사실을 뽑아라.`,
      '- 결과에 적힌 내용만 쓴다. 결과에 없는 것을 아는 대로 보태지 마라.',
      '- kind: "cultivation"(자생지·내한성·토양·볕·수형·생장·개화 결실·전정 시기·병해충·번식·주의) 또는 "lore"(전설·설화·이름 유래·꽃말·상징·역사·문화·쓰임새·문학·명소).',
      '- specific: 그 대상에만 해당하면 true, 어느 나무에나 통하는 일반론("물 빠짐이 좋아야 한다")이면 false.',
      '- ref: 그 사실이 적힌 결과 번호(1부터). 한 사실에 하나.',
      '- 각 사실은 한 문장, 최대 20개.',
      `[검색 결과]\n${numbered}`,
      'JSON 형식: {"facts":[{"text":"...","ref":1,"kind":"cultivation","specific":true}]}',
    ].join('\n\n');
    const json = await deps.llm(a.model, SYS, user, { maxOutputTokens: 2400, signal: a.signal });
    if (!json) return { ...base, status: 'error', resultCount: hits.length, facts: [], specificCount: 0, error: 'llm null' };
    const aliases = species ? (findSpeciesLoose(species)?.aliases ?? []) : [];
    const facts = attachRefs(json, hits, species, aliases);
    return { ...base, status: 'ok', resultCount: hits.length, facts, specificCount: facts.filter((f) => f.specific).length };
  } catch (e) {
    return { ...base, status: 'error', resultCount: 0, facts: [], specificCount: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
```

파일 상단 import 는 한 군데로 모은다(`findSpeciesLoose` 옆에 위 세 import 를 둔다 — ESLint/tsc 의 import 순서 규칙은 없지만 파일 중간 import 는 tsc 가 거부한다).

`src/sessions/digest.ts` — `readFactCard` 아래에:

```ts
import type { FactSupplyResult } from '../content/factSupply';
/** 사실 공급 결과(2026-09-17) — 검토 알림·리포트가 고유 사실 수를 읽는다. */
export function writeFactSupply(runId: string, r: FactSupplyResult): void { writeSessionFile(runId, 'fact_supply.json', JSON.stringify(r, null, 2)); }
export function readFactSupply(runId: string): FactSupplyResult | null {
  try {
    const r = JSON.parse(fs.readFileSync(sessionFile(runId, 'fact_supply.json'), 'utf-8')) as FactSupplyResult;
    return r && typeof r.specificCount === 'number' && Array.isArray(r.facts) ? r : null;
  } catch { return null; }
}
```
(import 는 파일 상단 import 블록에 넣는다.)

`src/config.ts` — 인터페이스에 `briefGateRounds` 아래:

```ts
  /** 사실 공급(2026-09-17) — 집필 전 수종 고유 사실(재배+이야기)을 코드가 검색·추출해 브리프에 붙인다. off 면 단계 생략(종전 동작). */
  readonly factSupply: boolean;
  /** 고유 사실 하한 — 자율 런이 이 미만이면 집필 보류·주제 교체(사용자 런은 표시만). */
  readonly factMinSpecific: number;
  /** 연속 사실 부족 재시도 상한(같은 시간대 60분 창) — 넘으면 그 주기는 건너뛴다. */
  readonly factSupplyRetry: number;
  /** 사실 부족 수종 재제안 금지 창(일). */
  readonly factStarvedDays: number;
```

값 블록에 `briefGateRounds:` 아래:

```ts
  // 사실 공급(2026-09-17) — 사실 카드에 식물 사실이 평균 3건(9편은 0건)이라 작가가 일반론으로 채우던 실측 대응.
  factSupply: envBool('FACT_SUPPLY', true),
  factMinSpecific: Math.min(Math.max(1, envInt('FACT_MIN_SPECIFIC', 5)), 20),
  factSupplyRetry: Math.min(Math.max(0, envInt('FACT_SUPPLY_RETRY', 2)), 5),
  factStarvedDays: Math.min(Math.max(0, envInt('FACT_STARVED_DAYS', 14)), 90),
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/content/factSupply.test.ts src/sessions/digest.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 오류 0

- [ ] **Step 5: 커밋**

```bash
git add src/content/factSupply.ts src/content/factSupply.test.ts src/sessions/digest.ts src/sessions/digest.test.ts src/config.ts
git commit -m "feat(content): 사실 공급 수집·추출 — 백과+웹 검색 뒤 LLM 추출 1회, ref 로 URL 대조

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 4: org.ts 훅 — 브리프에 붙이고, 부족하면 `FactStarvedError`

**Files:**
- Modify: `src/orchestrator/run.ts:22-47` (`RunOptions.factStrict`)
- Modify: `src/orchestrator/org.ts:825-837` (brief `const`→`let`, 훅), `:111-157`(작가 지침 한 줄), import 블록
- Test: `src/orchestrator/org.test.ts`

**Interfaces:**
- Consumes: `supplyFacts`, `factSupplyBlock`(Task 3), `writeFactSupply`(Task 3), `CONFIG.factSupply/factMinSpecific`
- Produces:
  ```ts
  // org.ts
  export class FactStarvedError extends Error { readonly count: number; readonly need: number; readonly species?: string; constructor(a: { topic: string; count: number; need: number; species?: string }) }
  export function isFactStarved(e: unknown): e is FactStarvedError
  // run.ts
  RunOptions.factStrict?: boolean
  ```

- [ ] **Step 1: 실패하는 테스트(org.test.ts 끝에)**

```ts
import { FactStarvedError, isFactStarved } from './org';

describe('FactStarvedError — 사실 부족 종료 신호', () => {
  it('count/need/species 를 싣고 name 으로 식별된다', () => {
    const e = new FactStarvedError({ topic: '음나무 자리', count: 2, need: 5, species: '음나무' });
    expect(e.name).toBe('FactStarvedError');
    expect(e.message).toContain('고유 사실 2건');
    expect(e.count).toBe(2); expect(e.need).toBe(5); expect(e.species).toBe('음나무');
    expect(isFactStarved(e)).toBe(true);
    expect(isFactStarved(new Error('x'))).toBe(false);
  });
});

describe('BLOG_BODY_GUIDE — 사실 공급 블록을 뼈대로 쓰라는 지침', () => {
  it('일반론으로 채우지 말라는 문장이 있다', () => {
    expect(BLOG_BODY_GUIDE).toContain('[재배·이야기 사실 조사');
    expect(BLOG_BODY_GUIDE).toContain('일반론으로 섹션을 채우지 마라');
    expect(blogBodyGuide(false)).toContain('일반론으로 섹션을 채우지 마라'); // 킬스위치 off 문구에도 — 골격 다양화와 무관한 지침
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/orchestrator/org.test.ts`
Expected: FAIL — `FactStarvedError` export 없음

- [ ] **Step 3: 구현**

`src/orchestrator/run.ts` `RunOptions`에 `personaText` 아래:

```ts
  /** 사실 공급 엄격 모드(2026-09-17) — true 면 고유 사실이 CONFIG.factMinSpecific 미만일 때 집필하지 않고
   *  FactStarvedError 로 끝낸다(자율 런 전용 — main.ts 가 auto && !userTriggered 로 계산). 사용자 런은 항상 false. */
  factStrict?: boolean;
```

`src/orchestrator/org.ts` import 블록에:

```ts
import { supplyFacts, factSupplyBlock } from '../content/factSupply';
```
그리고 `writeFactCard, readFactCard, writeBriefGate` 가 있는 digest import 에 `writeFactSupply` 추가.

`buildBlogBodyGuide` 의 `'- 사실·수치·시기·약제·품종 특성은 브리프·제공 자료에 있는 것만 쓴다.…'` 줄 **바로 앞**에 한 줄:

```ts
  // 사실 공급(2026-09-17) — 실측: 사실 카드에 식물 사실 평균 3건이라 작가가 어느 나무에나 맞는 일반론
  // (물 빠짐·잎 진 뒤·첫해 참기·화분은 반)으로 2,000자를 채웠고, 그게 "수종만 바뀐 같은 글"의 뿌리였다.
  '- 브리프 끝의 [재배·이야기 사실 조사(자동 수집)]가 있으면 그 고유 사실을 본문의 뼈대로 쓴다. 어느 나무에나 맞는 일반론으로 섹션을 채우지 마라 — 고유 사실이 없는 소주제는 짧게 지나가거나 뺀다.\n' +
```

`runOrg`의 `const brief = usableTeams…` → `let brief = usableTeams…` 로 바꾸고, `const serpText = …` 줄 **앞**(= `research` 판정 뒤)에 훅:

```ts
  // 사실 공급(2026-09-17) — 리서치팀은 키워드팀이라 브리프에 식물 사실이 거의 없다. 코드가 검색해 고유
  // 사실을 브리프 끝에 붙이고, 자율 런은 기준 미만이면 집필하지 않는다(주제 교체는 main.ts·scheduler 몫).
  // writeResearchBrief 앞이어야 한다 — 리비전이 research_brief.md 를 재주입하므로 블록이 파일에 함께 남아야 한다.
  if (CONFIG.factSupply && !research && brief.trim()) {
    const fsr = await supplyFacts({ topic, keyword: opts.keyword, model: assign.standard, signal });
    try { writeFactSupply(bus.runId, fsr); }
    catch (e) { bus.emit('log', { message: `사실 공급 영속화 실패(무해): ${e instanceof Error ? e.message : String(e)}` }); }
    const cult = fsr.facts.filter((f) => f.specific && f.kind === 'cultivation').length;
    const lore = fsr.facts.filter((f) => f.specific && f.kind === 'lore').length;
    const line = fsr.status === 'error'
      ? `사실 공급 — 실패(무해, 종전대로 집필): ${fsr.error ?? ''}`
      : `사실 공급 — "${fsr.subject}" 고유 사실 ${fsr.specificCount}건(재배 ${cult}·이야기 ${lore}) / 검색 결과 ${fsr.resultCount}건 / 질의 ${fsr.queries.length}개`;
    console.log(`[사실공급] ${line}`);
    bus.emit('log', { message: line });
    const block = fsr.status === 'ok' ? factSupplyBlock(fsr) : '';
    if (block) brief = `${brief}\n\n${block}`;
    if (fsr.status === 'ok' && fsr.specificCount < CONFIG.factMinSpecific) {
      if (opts.factStrict) throw new FactStarvedError({ topic, count: fsr.specificCount, need: CONFIG.factMinSpecific, species: fsr.species });
      mustFix.push(`수종 고유 사실이 ${fsr.specificCount}건(기준 ${CONFIG.factMinSpecific}) — 일반론으로 채우지 말고 있는 사실 안에서 짧게 써라`);
    }
  }
```

`mustFix`는 이미 이 위(`let mustFix: string[] = [];`, 브리프 게이트 앞)에 함수 스코프로 선언돼 있다 — 새로 선언하지 말 것.

`runOrg` 함수 **위**(export 들 옆)에 클래스:

```ts
/** 사실 부족 종료(2026-09-17) — 자율 런이 고유 사실 기준 미만일 때 집필 대신 던진다. main.ts 가 잡아
 *  piece 를 error+factStarved 로 기록하고 다음 틱을 띄운다(주제 교체). 일시 장애(isTransientFailure)와 다르다. */
export class FactStarvedError extends Error {
  readonly count: number;
  readonly need: number;
  readonly species?: string;
  constructor(a: { topic: string; count: number; need: number; species?: string }) {
    super(`사실 부족 — "${a.topic.slice(0, 40)}" 고유 사실 ${a.count}건 < ${a.need}`);
    this.name = 'FactStarvedError';
    this.count = a.count; this.need = a.need;
    if (a.species) this.species = a.species;
  }
}
export function isFactStarved(e: unknown): e is FactStarvedError {
  return e instanceof FactStarvedError || (e instanceof Error && e.name === 'FactStarvedError');
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/orchestrator/org.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/orchestrator/run.ts src/orchestrator/org.ts src/orchestrator/org.test.ts
git commit -m "feat(org): 집필 전 사실 공급 훅 — 브리프에 고유 사실 블록, 자율 런은 기준 미만이면 FactStarvedError

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 5: piece 기록 + main.ts — 사실 부족이면 주제 교체 재시도

**Files:**
- Modify: `src/content/pieces.ts` (`Piece.factStarved`, `markFactStarved`)
- Modify: `src/server/main.ts:412-530` (`factStrict` 계산, catch 분기, 재시도)
- Test: `src/content/pieces.test.ts`

**Interfaces:**
- Consumes: `isFactStarved`, `FactStarvedError`(Task 4), `stopAutoCycle.runNowPersistent`(main.ts 하단, 이미 존재), `CONFIG.factSupplyRetry`, `notify`
- Produces:
  ```ts
  // pieces.ts
  export interface FactStarvedInfo { ts: string; count: number; need: number; species?: string }
  Piece.factStarved?: FactStarvedInfo
  PieceStore.markFactStarved(id: string, info: FactStarvedInfo): Piece | undefined  // stage 'error' + errors MAX + factStarved
  ```

- [ ] **Step 1: 실패하는 테스트(pieces.test.ts `PieceStore` describe 안에)**

```ts
  it('markFactStarved — 사실 부족 조각은 error 로 닫히고 사유가 남는다(재개 대상 아님)', () => {
    const s = new PieceStore(dir);
    const p = s.create({ title: '음나무가 잘 자라는 자리', keyword: '음나무', auto: true });
    const m = s.markFactStarved(p.id, { ts: '2026-09-17T09:00:00.000Z', count: 2, need: 5, species: '음나무' });
    expect(m?.stage).toBe('error');
    expect(m?.factStarved).toEqual({ ts: '2026-09-17T09:00:00.000Z', count: 2, need: 5, species: '음나무' });
    expect(new PieceStore(dir).get(p.id)?.factStarved?.species).toBe('음나무');
    expect(selectResumablePiece(s.list(), () => false)).toBeNull(); // error 는 재개 대상이 아니다
  });
```
(`selectResumablePiece` 는 이미 이 테스트 파일이 import 하고 있다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/content/pieces.test.ts`
Expected: FAIL — `markFactStarved is not a function`

- [ ] **Step 3: 구현**

`src/content/pieces.ts` — `factGate?: FactGateInfo;` 아래:

```ts
  /** 사실 부족 종료(2026-09-17) — 자율 런이 고유 사실 기준 미만이라 집필하지 않은 조각. stage 는 error 로 닫히고
   *  이 기록이 같은 수종의 재제안을 CONFIG.factStarvedDays 동안 막는다(scheduler). rotationItems 는 error 를 빼므로 별도 필드. */
  factStarved?: FactStarvedInfo;
```
인터페이스 위쪽(`Piece` 정의 앞)에:

```ts
export interface FactStarvedInfo { ts: string; count: number; need: number; species?: string }
```
`recordError` 아래에:

```ts
  /** 사실 부족 종료 — 재시도 예산과 무관하게 바로 닫는다(다시 돌려도 검색 결과는 같다). */
  markFactStarved(id: string, info: FactStarvedInfo): Piece | undefined {
    if (!this.items.get(id)) return undefined;
    return this.update(id, { stage: 'error', errors: MAX_ERRORS, factStarved: info });
  }
```

`src/server/main.ts`:

(a) import — `startRun` import 줄 근처에 `import { isFactStarved } from '../orchestrator/org';`

(b) `launchRun` 안 `return startRun(bus, { … mission: opts.mission, persona: opts.persona, personaText: opts.personaText, })` 에 필드 추가:

```ts
        // 사실 공급 엄격 모드(2026-09-17) — 자율 런만. 사용자가 직접 띄운 런(수동·userTriggered 틱·리비전)은 절대 보류하지 않는다.
        factStrict: !!opts.auto && !opts.revise && opts.mission !== 'research'
          && !(opts.pieceId && pieceStore().get(opts.pieceId)?.userTriggered),
```

(c) 모듈 상단(다른 `let lastAutoRun` 근처)에:

```ts
// 사실 부족 재시도 창(2026-09-17) — 최근 60분 안의 사실 부족 종료 시각. 연속 부족이 CONFIG.factSupplyRetry 를
// 넘으면 그 주기는 건너뛴다(검색이 안 나오는 날에 틱을 계속 돌리지 않게). 시간 창이라 리셋 코드가 필요 없다.
let factStarvedAt: number[] = [];
```

(d) `.catch((e: unknown) => {` 안, `if (abort.signal.aborted || isAbort(e)) { … } else {` 의 else 첫 줄(`handle.status = 'error';` 뒤)에 **transient 판정보다 앞에** 분기:

```ts
        if (isFactStarved(e)) {
          // 사실 부족(2026-09-17) — 재시도 예산·에러 카운트가 아니라 '이 주제로는 못 쓴다'는 판정. 조각을 닫고
          // 같은 수종을 창 안에서 다시 안 잡게 기록한 뒤, 슬롯을 지키려 즉시 다음 틱을 띄운다(주제 교체).
          if (opts.pieceId) { try { pieceStore().markFactStarved(opts.pieceId, { ts: new Date().toISOString(), count: e.count, need: e.need, ...(e.species ? { species: e.species } : {}) }); } catch { /* 무해 */ } }
          console.log(`[사실공급] "${topic.slice(0, 30)}" — 고유 사실 ${e.count}건 < ${e.need} → 집필 보류, 주제 교체`);
          bus.emit(EventType.error, { message: e.message });
          bus.emit(EventType.run_done, { status: 'error' });
          const now = Date.now();
          factStarvedAt = [...factStarvedAt.filter((t) => now - t < 3_600_000), now];
          if (opts.auto) {
            if (factStarvedAt.length <= CONFIG.factSupplyRetry) {
              setTimeout(() => { void stopAutoCycle.runNowPersistent({ label: '사실 부족 재시도', respectToggle: true }); }, 1_000);
            } else {
              console.log(`[사실공급] 사실 부족 ${factStarvedAt.length}연속 — 이번 주기 건너뜀(다음 정각·타이머 틱에서 재개)`);
              void notify({ title: '⏸ 이번 주기 건너뜀 — 사실 부족', body: `최근 1시간에 ${factStarvedAt.length}개 주제가 수종 고유 사실 ${e.need}건을 못 채웠습니다. 다음 틱에서 다시 시도합니다.` }).catch(() => { /* 무해 */ });
            }
          }
          return;
        }
```
`return` 뒤에 오는 기존 코드(transient·recordError·run_done)는 그대로 둔다. `EventType` 은 이미 import 돼 있다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/content/pieces.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 0. `stopAutoCycle`은 모듈 하단 `const`지만 catch 는 런타임에 실행되므로 TDZ 문제 없음 — tsc 가 "used before declaration"을 내면 `setTimeout` 콜백 안이라 통과한다(콜백 밖으로 빼지 말 것).

- [ ] **Step 5: 커밋**

```bash
git add src/content/pieces.ts src/content/pieces.test.ts src/server/main.ts
git commit -m "feat(main): 사실 부족 자율 런은 조각을 닫고 즉시 다음 주제로 — 60분 창 2회 상한

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 6: scheduler — 사실 부족 수종은 14일 동안 다시 안 잡는다

**Files:**
- Modify: `src/autonomy/scheduler.ts` (`speciesRecencyFor` 옆에 헬퍼, 후보 루프 게이트)
- Test: `src/autonomy/scheduler.test.ts`

**Interfaces:**
- Consumes: `speciesRecency(items, speciesOf, now, days)`, `usedRecently(text, map, speciesOf)`(`src/content/speciesRotation`), `pieceStore().list()`, `Piece.factStarved`
- Produces:
  ```ts
  export function factStarvedItems(pieces: Array<{ title: string; keyword?: string; brand?: string; factStarved?: { ts: string } }>, slug: string | undefined): Array<{ title: string; keyword?: string; ts: string }>
  ```

- [ ] **Step 1: 실패하는 테스트(scheduler.test.ts 끝에)**

```ts
import { factStarvedItems } from './scheduler';

describe('factStarvedItems — 사실 부족 기록을 로테이션 재료로', () => {
  it('브랜드가 같고 factStarved 가 있는 조각만, ts 는 부족 판정 시각', () => {
    const pieces = [
      { title: '음나무 자리', keyword: '음나무', brand: 'b', factStarved: { ts: '2026-09-17T09:00:00.000Z' } },
      { title: '호두나무 뿌리', keyword: '호두나무', brand: 'b' },
      { title: '감나무 거름', keyword: '감나무', brand: 'other', factStarved: { ts: '2026-09-10T00:00:00.000Z' } },
    ];
    expect(factStarvedItems(pieces, 'b')).toEqual([{ title: '음나무 자리', keyword: '음나무', ts: '2026-09-17T09:00:00.000Z' }]);
  });
  it('slug 미지정(범용 모드)은 brand 없는 조각만', () => {
    const pieces = [{ title: 'a', factStarved: { ts: 't' } }, { title: 'b', brand: 'x', factStarved: { ts: 't' } }];
    expect(factStarvedItems(pieces, undefined).map((i) => i.title)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/autonomy/scheduler.test.ts -t factStarvedItems`
Expected: FAIL — export 없음

- [ ] **Step 3: 구현**

`rotationItems` 바로 아래:

```ts
/** 사실 부족 기록(2026-09-17)을 로테이션 재료 꼴로 — rotationItems 는 error 조각을 빼므로 별도. ts 는 부족 판정 시각. */
export function factStarvedItems(
  pieces: Array<{ title: string; keyword?: string; brand?: string; factStarved?: { ts: string } }>, slug: string | undefined,
): Array<{ title: string; keyword?: string; ts: string }> {
  return pieces
    .filter((p) => (p.brand ?? '') === (slug ?? '') && p.factStarved?.ts)
    .map((p) => ({ title: p.title, ...(p.keyword ? { keyword: p.keyword } : {}), ts: p.factStarved!.ts }));
}
/** 최근 CONFIG.factStarvedDays 안에 사실 부족으로 닫힌 수종 → 며칠 전. */
export function factStarvedRecencyFor(slug: string | undefined, now = new Date()): Map<string, number> {
  try { return speciesRecency(factStarvedItems(pieceStore().list(), slug), speciesKeyOf, now, CONFIG.factStarvedDays); }
  catch { return new Map(); }
}
```

후보 루프 준비부(`const speciesRecent = speciesRecencyFor(slug);` 아래):

```ts
  const factStarvedRecent = factStarvedRecencyFor(slug);   // 사실 부족 수종(2026-09-17) — 검색해도 안 나온 수종은 창 안에서 재제안 금지
```

후보 루프의 수종 앵커 게이트 **바로 앞**에:

```ts
      // 사실 부족 수종 게이트(하드, 비용 0, 2026-09-17) — 고유 사실이 기준 미만이라 집필 못 한 수종은 각도를
      // 바꿔도 같은 검색 결과다. 지시 중에도 건다. 마지막 라운드에도 기각(후순위로 살리면 같은 벽에 또 부딪힌다).
      const starved = usedRecently(`${title} ${keyword ?? ''}`, factStarvedRecent, speciesKeyOf);
      if (starved) {
        console.log(`[auto-cycle] 아이디어 기각(사실 부족 수종) — "${title}" (${starved.name} ${starved.daysAgo}일 전)`);
        rejects.push(`"${title}"=최근 ${CONFIG.factStarvedDays}일 안에 사실 부족으로 닫힌 수종(${starved.name} — 자료가 있는 다른 수종으로)`);
        continue;
      }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/autonomy/scheduler.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/autonomy/scheduler.ts src/autonomy/scheduler.test.ts
git commit -m "feat(topic): 사실 부족으로 닫힌 수종은 14일 동안 다시 안 잡는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 7: 내용 모듈 카탈로그 + 판정·금지 목록(순수)

**Files:**
- Modify: `src/content/brand.ts:74`(타입), `:261-268`(로더)
- Modify: `data/brands/bionditree.yaml` (`compoundStems:` 앞에 `contentModules:`)
- Create: `src/content/contentModules.ts`
- Test: `src/content/contentModules.test.ts`, `src/content/brand.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // brand.ts
  BrandProfile.contentModules?: Array<{ name: string; match: string[] }>
  // contentModules.ts
  export interface ContentModule { name: string; match: string[] }
  export function modulesInBody(body: string, modules: readonly ContentModule[] | undefined): string[]
  export function modulesToAvoid(recentBodies: readonly string[], modules: readonly ContentModule[] | undefined, topicText: string): string[]
  export function moduleAvoidBlock(names: readonly string[], modules: readonly ContentModule[] | undefined): string
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/content/contentModules.test.ts
import { describe, it, expect } from 'vitest';
import { modulesInBody, modulesToAvoid, moduleAvoidBlock } from './contentModules';
import type { ContentModule } from './contentModules';

const M: ContentModule[] = [
  { name: '화분 vs 마당', match: ['화분'] },
  { name: '첫해 참기', match: ['첫해', '첫 해'] },
  { name: '묘목 보는 자리', match: ['묘목', '뿌리목', '접목부'] },
  { name: '다음 편 예고', match: ['이어지는 편', '따로 적겠'] },
];

describe('modulesInBody — 소제목 1회 또는 본문 3회', () => {
  it('소제목에 토큰이 있으면 1회로도 모듈', () => {
    expect(modulesInBody('## 화분에서 될까\n본문', M)).toEqual(['화분 vs 마당']);
    expect(modulesInBody('### 심은 첫 해에 하지 않는 일\n본문', M)).toEqual(['첫해 참기']);
  });
  it('본문에는 3회 이상이어야 모듈, 언급 1~2회는 안 센다', () => {
    expect(modulesInBody('묘목을 봅니다. 묘목이 좋다. 묘목 고르기.', M)).toEqual(['묘목 보는 자리']);
    expect(modulesInBody('화분도 됩니다. 화분은 반만.', M)).toEqual([]);
  });
  it('여러 토큰의 횟수는 합산, 같은 모듈은 1번, 카탈로그 없으면 빈 배열', () => {
    expect(modulesInBody('뿌리목 한 번, 접목부 두 번, 접목부 세 번', M)).toEqual(['묘목 보는 자리']);
    expect(modulesInBody('## 화분\n화분 화분 화분', M)).toEqual(['화분 vs 마당']);
    expect(modulesInBody('## 화분', undefined)).toEqual([]);
  });
});

describe('modulesToAvoid — 최근 편 합집합, 주제가 요구하는 모듈은 예외', () => {
  const bodies = ['## 화분에서 될까\n…', '## 첫해에 참는 일\n…', '묘목 묘목 묘목'];
  it('세 편에 나온 모듈 전부', () => {
    expect(modulesToAvoid(bodies, M, '음나무 자리 고르기')).toEqual(['화분 vs 마당', '첫해 참기', '묘목 보는 자리']);
  });
  it('주제 제목·키워드에 토큰이 있으면 그 모듈은 뺀다', () => {
    expect(modulesToAvoid(bodies, M, '음나무 묘목 고르기 음나무 묘목')).toEqual(['화분 vs 마당', '첫해 참기']);
    expect(modulesToAvoid(bodies, M, '베란다 화분 나무 첫 해')).toEqual(['묘목 보는 자리']);
  });
  it('빈 입력은 빈 배열', () => {
    expect(modulesToAvoid([], M, 'x')).toEqual([]);
    expect(modulesToAvoid(bodies, [], 'x')).toEqual([]);
  });
});

describe('moduleAvoidBlock', () => {
  it('이름과 토큰 예시를 싣고, 비면 빈 문자열', () => {
    const b = moduleAvoidBlock(['화분 vs 마당', '첫해 참기'], M);
    expect(b.startsWith('[이번 글 금지 모듈]')).toBe(true);
    expect(b).toContain('화분 vs 마당(화분)');
    expect(b).toContain('첫해 참기(첫해, 첫 해)');
    expect(moduleAvoidBlock([], M)).toBe('');
  });
});
```

brand.test.ts 끝에:

```ts
describe('normalizeBrand — contentModules / topicThemes 상한', () => {
  it('contentModules 를 name+match 로 정규화하고 빈 항목은 버린다', () => {
    const b = normalizeBrand({ name: 'x', contentModules: [{ name: '화분 vs 마당', match: ['화분'] }, { name: '', match: ['a'] }, { name: 'b', match: [] }] } as never);
    expect(b?.contentModules).toEqual([{ name: '화분 vs 마당', match: ['화분'] }]);
  });
  it('topicThemes 는 32개까지 받는다(이야기 5축 추가로 24 초과)', () => {
    const themes = Array.from({ length: 30 }, (_, i) => ({ theme: `t${i}`, seeds: [], match: [`m${i}`] }));
    expect(normalizeBrand({ name: 'x', topicThemes: themes } as never)?.topicThemes).toHaveLength(30);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/content/contentModules.test.ts src/content/brand.test.ts`
Expected: FAIL — 모듈 없음 / `contentModules` undefined / topicThemes 24

- [ ] **Step 3: 구현**

`src/content/brand.ts` — 타입(`topicThemes?:` 아래):

```ts
  /** 내용 모듈 카탈로그(2026-09-17) — 글마다 반복되던 소재 덩어리(화분 vs 마당·묘목 보는 자리·첫해 참기…).
   *  match 는 본문·소제목 대조 토큰. 최근 N편에 나온 모듈은 작가에게 금지 목록으로 간다(미설정=로테이션 없음). */
  contentModules?: Array<{ name: string; match: string[] }>;
```
로더(`topicThemes:` 블록의 `.slice(0, 24)` → `.slice(0, 32)` 로 바꾸고, 그 아래):

```ts
    contentModules: (Array.isArray(raw?.contentModules) ? raw.contentModules as unknown[] : [])
      .map((m) => ({ name: s((m as { name?: unknown })?.name, 30) ?? '', match: arr((m as { match?: unknown })?.match, 12, 20) }))
      .filter((m) => m.name && m.match.length)
      .slice(0, 20),
```

`data/brands/bionditree.yaml` — `compoundStems:` 바로 앞에:

```yaml
# 내용 모듈(2026-09-17) — 수종만 바뀐 채 매 글에 반복되던 소재 덩어리. 최근 5편에 나온 모듈은 이번 글에서 금지.
# 실측(75편): 묘목 보는 자리 80% · 잎 진 뒤/첫해 78% · 화분 61% · 거름 자리 60%.
contentModules:
  - name: 묘목 보는 자리
    match: [묘목, 뿌리목, 접목부, 접붙]
  - name: 화분 vs 마당
    match: [화분]
  - name: 시기 미루기(잎 진 뒤)
    match: [잎이 진, 잎이 다 진, 낙엽 진, 잎 진 뒤, 낙엽이 끝]
  - name: 첫해 참기
    match: [첫해, 첫 해]
  - name: 이름·닮은 나무 구별
    match: [구별, 구분, 헷갈, 한 나무, 같은 나무]
  - name: 오늘 할 일 하나
    match: [오늘 할, 오늘 그루, 말뚝, 리본]
  - name: 다음 편 예고
    match: [이어지는 편, 따로 적겠, 다음 편, 다음 글]
  - name: 거름 자리(가지 끝 둘레)
    match: [가지 끝 아래, 가지 끝이 그리는, 수관 둘레, 밑동은 비우]
  - name: 자르는 자리(눈 위)
    match: [눈 하나 위, 눈 위]
```

`src/content/contentModules.ts`:

```ts
/**
 * 내용 모듈 로테이션(2026-09-17) — "수종만 바뀐 같은 글"의 두 번째 원인(첫째는 사실 기아, factSupply).
 *
 * 실측(최근 75편): 문장 반복은 2.6%인데 본문 기준 묘목 보는 자리 80%·잎 진 뒤/첫해 78%·화분 vs 마당 61%.
 * 기존 가드(스타일지문·상투구·마무리 회피)는 표면만 바꿨고, 수종이 다르면 priorCoverage 는 안 걸렸다.
 * 여기서는 소재 덩어리(모듈)를 결정적으로 판정해 최근 N편에 나온 모듈을 작가에게 금지 목록으로 준다 —
 * 수종·축 날짜 창과 같은 원리. 주제가 요구하는 모듈("음나무 묘목 고르기"의 묘목)은 금지에서 뺀다.
 */
import { CONFIG } from '../config';
import { getBrand } from './brand';          // brand.ts 는 pieces/priorCoverage 를 import 하지 않는다 — 순환 없음(확인 2026-09-17)
import { pieceStore } from './pieces';
import { blogBodyOf } from './priorCoverage';

export interface ContentModule { name: string; match: string[] }

const compact = (s: string): string => (s ?? '').normalize('NFC').replace(/\s+/g, '');
const count = (hay: string, needle: string): number => {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** 모듈이 '있다' = 소제목(##/###)에 토큰 1회 또는 본문에 토큰 합계 3회 이상. 지나가는 언급은 안 센다. */
export function modulesInBody(body: string, modules: readonly ContentModule[] | undefined): string[] {
  if (!body || !modules?.length) return [];
  const headings = compact(body.split('\n').filter((l) => /^#{2,3}\s/.test(l)).join('\n'));
  const whole = compact(body);
  const out: string[] = [];
  for (const m of modules) {
    const toks = m.match.map(compact).filter(Boolean);
    const inHeading = toks.some((t) => headings.includes(t));
    const total = toks.reduce((a, t) => a + count(whole, t), 0);
    if (inHeading || total >= 3) out.push(m.name);
  }
  return out;
}

/** 최근 편 모듈 합집합 − 주제 제목·키워드가 토큰을 품은 모듈. 순서는 카탈로그 순. */
export function modulesToAvoid(recentBodies: readonly string[], modules: readonly ContentModule[] | undefined, topicText: string): string[] {
  if (!recentBodies.length || !modules?.length) return [];
  const used = new Set<string>();
  for (const b of recentBodies) for (const n of modulesInBody(b, modules)) used.add(n);
  const topic = compact(topicText);
  return modules
    .filter((m) => used.has(m.name) && !m.match.some((t) => compact(t) && topic.includes(compact(t))))
    .map((m) => m.name);
}

export function moduleAvoidBlock(names: readonly string[], modules: readonly ContentModule[] | undefined): string {
  if (!names.length || !modules?.length) return '';
  const items = names.map((n) => {
    const m = modules.find((x) => x.name === n);
    return m ? `${m.name}(${m.match.slice(0, 3).join(', ')})` : n;
  });
  return `[이번 글 금지 모듈] 최근 글들에 이미 쓴 다음 소재는 이번 글에서 섹션·문단으로 다루지 마라(한 문장 언급도 피한다): ${items.join(' · ')}. `
    + '이 소재가 정말 필요하면 그건 다음 글의 몫이다 — 이번 글은 제목이 약속한 축 안에서 고유 사실로 깊이를 낸다.';
}

/** 최근 limit 편 초안에서 금지 목록 — recentBlogEndings 와 같은 자리·같은 fail-open. */
export function recentModulesToAvoid(brandSlug: string | undefined, topicText: string, limit = CONFIG.moduleRecentPieces): string[] {
  try {
    const modules = getBrandModules();
    if (!modules.length) return [];
    const brandOk = (b?: string): boolean => brandSlug === undefined || (b ?? undefined) === brandSlug;
    const bodies: string[] = [];
    for (const e of [...pieceStore().list()].reverse()) {   // list() 는 오래된 순 — 뒤집어 최신부터
      if (!brandOk(e.brand) || e.stage === 'idea' || e.stage === 'error') continue;
      const body = blogBodyOf(e.runId);
      if (body) bodies.push(body);
      if (bodies.length >= limit) break;
    }
    return modulesToAvoid(bodies, modules, topicText);
  } catch { return []; }
}

function getBrandModules(): ContentModule[] {
  return getBrand()?.contentModules ?? [];
}
```

`src/content/priorCoverage.ts` — `function blogBodyOf` → `export function blogBodyOf` (같은 파일의 다른 호출은 그대로).

`src/config.ts` — 인터페이스 `factStarvedDays` 아래:

```ts
  /** 내용 모듈 로테이션(2026-09-17) — 최근 N편에 쓴 소재 모듈을 작가 금지 목록으로. off 면 블록 미주입(종전 동작). */
  readonly moduleRotation: boolean;
  /** 금지 목록을 만들 최근 편 수(1~20). 하루 2~3편이라 5편 ≈ 이틀. */
  readonly moduleRecentPieces: number;
```
값:

```ts
  moduleRotation: envBool('MODULE_ROTATION', true),
  moduleRecentPieces: Math.min(Math.max(1, envInt('MODULE_RECENT_PIECES', 5)), 20),
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/content/contentModules.test.ts src/content/brand.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/content/contentModules.ts src/content/contentModules.test.ts src/content/brand.ts src/content/brand.test.ts src/content/priorCoverage.ts src/config.ts data/brands/bionditree.yaml
git commit -m "feat(content): 내용 모듈 카탈로그·판정·금지 목록 — 최근 5편에 쓴 소재 덩어리는 이번 글에서 뺀다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 8: 작가 프롬프트 — 금지 모듈 주입 + `buildGenreGuide` 정정

**Files:**
- Modify: `src/orchestrator/org.ts:203-215`(genreGuide), `:268-300`(가드 조립), `:326`(호출), `:353`(로그), `:375-390`(context)
- Test: `src/orchestrator/org.test.ts`

**Interfaces:**
- Consumes: `recentModulesToAvoid`, `moduleAvoidBlock`(Task 7), `getBrand()?.contentModules`, `CONFIG.moduleRotation`
- Produces: `export function buildGenreGuide(axes: readonly string[], teaser?: boolean, avoidTodayAction?: boolean): string`

- [ ] **Step 1: 실패하는 테스트(org.test.ts `buildGenreGuide` describe 안에 추가)**

```ts
  it('다른 축 섹션을 덧붙이라는 문장이 없고, 한 축만 깊게 다루라는 문장이 있다', () => {
    const g = buildGenreGuide(axes);
    expect(g).not.toContain('최소 한 개 섹션은 다른 축으로');
    expect(g).not.toContain('첫 계절에 실제로 하는 일');
    expect(g).toContain('제목이 약속한 축 하나만');
    expect(g).toContain('다른 축의 섹션을 덧붙이지');
  });
  it('avoidTodayAction 이면 "오늘 해볼 행동" 요구를 뺀다', () => {
    expect(buildGenreGuide(axes, false, true)).not.toContain('행동을 최소 하나 제시하라');
    expect(buildGenreGuide(axes, false, false)).toContain('행동을 최소 하나 제시하라');
  });
  it('이야기 글(전설·꽃말·유래…) 예외가 명시된다', () => {
    expect(buildGenreGuide(axes)).toContain('전설·설화·꽃말·유래');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/orchestrator/org.test.ts -t buildGenreGuide`
Expected: FAIL (3건)

- [ ] **Step 3: 구현**

`buildGenreGuide` 전체를 이렇게 바꾼다(주석은 유지):

```ts
export function buildGenreGuide(axes: readonly string[], teaser?: boolean, avoidTodayAction?: boolean): string {
  if (!axes.length) return '';
  return `[글의 성격] 이 블로그가 한 가지 틀로만 반복되지 않게, 다음 축을 골고루 쓴다 — ${axes.map((x: string, i: number) => `${i + 1}) ${x}`).join(' ')}. `
    // 2026-09-17 정정 — 종전 "최소 한 개 섹션은 다른 축으로 + 구매 주제면 첫 계절·실패·회복까지"가 매 글을
    // 모든 축의 합집합으로 만들었다(실측 75편: 5개 이상 모듈 44편). 한 글은 한 축만, 깊이는 고유 사실로.
    + '**이 글은 제목이 약속한 축 하나만 다룬다. 다른 축의 섹션을 덧붙이지 말고, 그 축 안에서 [재배·이야기 사실 조사]의 고유 사실로 깊이를 낸다.** '
    + '**주제가 대상 이름만 주어졌고 각도가 없으면(예: 품종명 한 단어), 구매·고르기를 기본값으로 잡지 마라** — '
    + '위 축 가운데 [이미 포화된 소재]·[최근 발행]에 덜 나온 축을 골라 각도를 세워라. '
    + (avoidTodayAction ? '' : '독자가 오늘 실제로 해볼 수 있는 행동을 최소 하나 제시하라("기록만 해두라"로 끝내지 말 것). ')
    // 관찰·이야기 축 예외(2026-08-13, 2026-09-17 확장) — 개화·단풍·낙엽 관찰뿐 아니라 전설·꽃말·유래·역사·
    // 쓰임새·문학·명소 글도 심기·전정 작업 지시로 억지 착지하면 하우투로 되돌아간다.
    + '단, 관찰·이야기 글(개화·단풍·낙엽 관찰, 전설·설화·꽃말·유래·역사·쓰임새·문학·명소)은 예외다 — 심기·전정 같은 작업 지시로 억지 마무리하지 말고, 이야기가 가리키는 것(지금 어디서 무엇을 보면 되는지, 그 나무를 마당에 들일 때 이야기가 남긴 한 가지)으로 끝내도 좋다. '
    + (teaser ? '' : '맺음을 "다음 글에서는…" 예고로 닫지 마라 — 이 글 안에서 완결한다.');
}
```

`writeBlogBody` 가드 조립부 — `const endingAvoid = …` 아래에:

```ts
  // 내용 모듈 로테이션(2026-09-17) — 표면(문형·상투구)이 아니라 소재 덩어리를 돌린다. 수종이 달라 priorCoverage 가
  // 안 걸리는 글끼리도 화분·묘목·첫해가 매번 겹치던 실측 대응. revise 는 본문 유지가 목적이라 제외.
  const moduleNames = (revise || !CONFIG.moduleRotation) ? [] : recentModulesToAvoid(brandSlug, `${topic} ${keyword ?? ''}`);
  const moduleAvoid = moduleNames.length ? moduleAvoidBlock(moduleNames, getBrand()?.contentModules) : '';
```

`const genreGuide = buildGenreGuide(axes, teaser);` → `const genreGuide = buildGenreGuide(axes, teaser, moduleNames.includes('오늘 할 일 하나'));`
(`endingAvoid`(≈277행) 아래에 두면 `genreGuide`(≈326행)보다 위라 순서는 그대로 맞는다.)

로그 줄(`작가 다양성 가드 — …`) 끝에 덧붙임:

```ts
 + ` · 금지모듈 ${moduleNames.length}건${moduleNames.length ? `(${moduleNames.slice(0, 3).join(', ')}${moduleNames.length > 3 ? ' 외' : ''})` : ''}`
```

`context:` 배열 — `endingAvoid,` 다음 줄에 `moduleAvoid,` (재집필 retry 의 context 배열에도 `styleAvoid,` 다음에 `moduleAvoid,`).

import: `import { recentModulesToAvoid, moduleAvoidBlock } from '../content/contentModules';`

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/orchestrator/org.test.ts && pnpm tsc --noEmit`
Expected: PASS(기존 `행동을 최소 하나 제시하라` 테스트는 기본 인자에서 그대로 통과), tsc 0

- [ ] **Step 5: 커밋**

```bash
git add src/orchestrator/org.ts src/orchestrator/org.test.ts
git commit -m "feat(org): 작가에게 금지 모듈 주입 — 한 글은 한 축만, 다른 축 섹션 추가 요구를 뺀다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 9: 읽을 거리 축 — topicThemes +5, 두뇌 프롬프트·각도, 수종 앵커 보강

**Files:**
- Modify: `data/brands/bionditree.yaml` (`topicThemes:` 목록 끝)
- Modify: `src/autonomy/scheduler.ts:517-521`(프롬프트), `:541-544`(IDEA_ANGLES), `:567-572`(`lacksSpeciesAnchor`)
- Test: `src/autonomy/scheduler.test.ts:339-354`

**Interfaces:**
- Consumes: `findSpeciesLoose`(이미 import 됨)
- Produces: `lacksSpeciesAnchor(text)` — 트리거 `꽃말|유래|전설|설화|민담|신화`, 앵커 = `findSpeciesLoose` 적중 또는 `○○나무`

- [ ] **Step 1: 실패하는 테스트(기존 `lacksSpeciesAnchor` describe 에 추가)**

```ts
  it('전설·설화·민담·신화도 트리거다(2026-09-17 읽을 거리 축)', () => {
    expect(lacksSpeciesAnchor('나무에 얽힌 전설 모음')).toBe(true);
    expect(lacksSpeciesAnchor('은행나무 전설, 천 년을 산 나무')).toBe(false);
  });
  it("'나무'로 안 끝나는 수종도 사전 적중이면 앵커다(능소화·무궁화)", () => {
    expect(lacksSpeciesAnchor('능소화 꽃말과 전설')).toBe(false);
    expect(lacksSpeciesAnchor('무궁화 이름의 유래')).toBe(false);
    expect(lacksSpeciesAnchor('장미 꽃말과 전설')).toBe(true); // 사전에 '장미' 단독 항목 없음 — 화초 미끄러짐 그대로 기각
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/autonomy/scheduler.test.ts -t lacksSpeciesAnchor`
Expected: FAIL (2건 — '나무에 얽힌 전설' 은 트리거 안 걸려 false, 능소화는 true)

- [ ] **Step 3: 구현**

`lacksSpeciesAnchor`:

```ts
export function lacksSpeciesAnchor(text: string): boolean {
  const t = (text || '').normalize('NFC');
  // '상징'은 수사적 사용("가을의 상징")이 흔해 트리거에서 제외 — 축의 핵심 표지만 본다.
  // 2026-09-17 읽을 거리 축 — 전설·설화·민담·신화도 같은 함정(총칭·화초 미끄러짐)이라 트리거에 넣는다.
  if (!/꽃말|유래|전설|설화|민담|신화/.test(t)) return false;
  // 앵커 = 수종 사전 적중(능소화·무궁화처럼 '나무'로 안 끝나는 수종) 또는 ○○나무 표기.
  if (findSpeciesLoose(t)) return false;
  return !/[가-힣]{1,6}나무/.test(t);
}
```

두뇌 프롬프트(517-521행) — 아래 두 문장을 교체:

- `'다음에 제작하면 검색 노출·유입에 가치있는 네이버 블로그(정보/하우투·리뷰) 콘텐츠 아이디어를 …'` → `'다음에 제작하면 검색 노출·유입에 가치있는 네이버 블로그 콘텐츠 아이디어(정보·하우투·리뷰와 **읽을 거리** — 전설·설화·꽃말·유래·역사·쓰임새·문학·명소처럼 수종과 얽힌 이야기)를 …'` (나머지 문장 그대로)
- `'- 검색 의도가 뚜렷하고 실용적인 주제(하우투/비교/리뷰/체크리스트 등). 시의성·계절성도 고려한다.\n'` → `'- 실용 주제(하우투/비교/리뷰/체크리스트)와 읽을 거리(전설·꽃말·유래·역사·쓰임새 이야기)를 섞어라 — 8개 중 최소 2개는 읽을 거리. 이야기 후보의 keyword 는 수종명 그대로(예: keyword "회화나무" + 제목 "회화나무가 선비의 나무가 된 이유"). 시의성·계절성도 고려한다.\n'`

`IDEA_ANGLES` 끝에 `'읽을 거리(전설·설화·꽃말·유래·역사·쓰임새·문학·명소 속 이 나무)'` 추가.

`data/brands/bionditree.yaml` `topicThemes:` 마지막 항목(`노목·오래된 나무 관리`) 뒤에:

```yaml
  # 읽을 거리 축(2026-09-17 사장님) — 24축 중 22축이 재배·관리라 이야기 글감이 주제 단계에서 배제돼 있었다.
  - theme: 전설·설화·민담
    seeds: [나무 전설, 나무 설화, 마을 나무 이야기]
    match: [전설, 설화, 민담, 옛이야기, 신화]
  - theme: 꽃말·상징·이름 유래
    seeds: [나무 꽃말, 나무 이름 유래, 나무 상징]
    match: [꽃말, 상징, 유래, 이름의 뜻, 라 부르는 이유]
  - theme: 역사·문화·쓰임새
    seeds: [궁궐 나무, 서원 나무, 나무 목재 쓰임, 약재 나무]
    match: [역사, 궁궐, 서원, 마을 나무, 목재, 약재, 쓰임, 풍습]
  - theme: 문학·예술 속 나무
    seeds: [시 속의 나무, 그림 속 나무, 노래 속 나무]
    match: [시 속, 소설, 그림, 노래, 시조, 민요]
  - theme: 명소·군락지·풍경
    seeds: [나무 명소, 가로수길, 군락지, 천연기념물 나무]
    match: [명소, 군락, 가로수길, 숲길, 천연기념물, 보호수]
```
(`match` 토큰은 `themeInText` 가 **가장 앞에 나오는 토큰**으로 축을 잡으므로 '시'처럼 짧은 토큰은 쓰지 않는다 — '시 속'으로 둔다.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/autonomy/scheduler.test.ts src/content/topicThemes.test.ts && pnpm tsc --noEmit`
Expected: PASS, tsc 0. 그리고 `TZ=Asia/Seoul npx tsx scripts/rotation_report.ts | head -8` 에 `쓴 축 N/29` 로 분모가 29가 됐는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add data/brands/bionditree.yaml src/autonomy/scheduler.ts src/autonomy/scheduler.test.ts
git commit -m "feat(topic): 읽을 거리 축 5개 — 전설·꽃말·역사·문학·명소를 주제 선정에 넣는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 10: rotation_report.ts — 모듈 분포·이야기 축 비율

**Files:**
- Modify: `scripts/rotation_report.ts:34-60`(summarize)

**Interfaces:**
- Consumes: `modulesInBody`(Task 7), `getBrand()?.contentModules`, `blogBodyOf`(Task 7 에서 export)

- [ ] **Step 1: 구현(스크립트 — 단위 테스트 대신 실행으로 검증)**

import 에 추가:

```ts
import { modulesInBody } from '../src/content/contentModules';
import { blogBodyOf } from '../src/content/priorCoverage';
```
`Piece` 인터페이스에 `runId?: string` 추가(`load` 의 JSON 에 이미 있다).

`summarize` 의 `const out = [ … ]` 뒤, `return out;` 앞에:

```ts
  // 이야기 축 비율(2026-09-17 읽을 거리 축) — 5축 합이 15% 미만이면 쿼터를 후속 결정(스펙 §4-1).
  const LORE = new Set(['전설·설화·민담', '꽃말·상징·이름 유래', '역사·문화·쓰임새', '문학·예술 속 나무', '명소·군락지·풍경']);
  const loreN = [...themes.entries()].filter(([t]) => LORE.has(t)).reduce((a, r) => a + r[1], 0);
  out.push(`  이야기 — 5축 합 ${loreN}편(${themed ? Math.round((loreN / themed) * 100) : 0}%)`);
  // 모듈 분포(2026-09-17) — 기준선(규칙 전 75편): 묘목 80% · 잎 진 뒤/첫해 78% · 화분 61%.
  const mods = getBrand()?.contentModules ?? [];
  if (mods.length && s.pieces.length) {
    const cnt = new Map<string, number>();
    let withBody = 0;
    for (const p of s.pieces) {
      const body = blogBodyOf(p.runId);
      if (!body) continue;
      withBody++;
      for (const m of modulesInBody(body, mods)) cnt.set(m, (cnt.get(m) ?? 0) + 1);
    }
    const line = mods.map((m) => `${m.name} ${withBody ? Math.round(((cnt.get(m.name) ?? 0) / withBody) * 100) : 0}%`).join(' · ');
    out.push(`  모듈 — (본문 있는 ${withBody}편) ${line}`);
  }
```

- [ ] **Step 2: 실행 확인**

Run: `TZ=Asia/Seoul npx tsx scripts/rotation_report.ts`
Expected: 두 슬라이스 모두에 `이야기 — 5축 합 …` 과 `모듈 — (본문 있는 N편) 묘목 보는 자리 NN% · …` 줄이 찍힌다. 규칙 전 슬라이스의 묘목·시기·화분 수치가 §0 실측(80/78/61 — 판정 규칙이 달라 ±10%p)과 같은 자리수인지 본다.

- [ ] **Step 3: 커밋**

```bash
git add scripts/rotation_report.ts
git commit -m "chore(scripts): 로테이션 리포트에 모듈 분포·이야기 축 비율

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```

---

### Task 11: 전체 검증 + .env 문서 + 서버 반영 + 실런 확인

**Files:**
- Modify: `.env` (주석 블록 추가, 값은 기본)

- [ ] **Step 1: .env 에 새 키 문서화(`SPECIES_RECENT_DAYS` 블록 근처)**

```
# 사실 공급(2026-09-17) — 집필 전 수종 고유 사실(재배+이야기)을 코드가 검색·추출. 자율 런은 하한 미만이면 주제 교체.
# FACT_SUPPLY=on  FACT_MIN_SPECIFIC=5  FACT_SUPPLY_RETRY=2  FACT_STARVED_DAYS=14
# 내용 모듈 로테이션(2026-09-17) — 최근 N편에 쓴 소재 모듈(화분·묘목·첫해…)은 이번 글에서 금지.
# MODULE_ROTATION=on  MODULE_RECENT_PIECES=5
```

- [ ] **Step 2: 전체 테스트·타입체크**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. 실패하면 여기서 멈추고 고친다(다음 단계로 가지 않는다).

- [ ] **Step 3: 서버 재기동**

Run: `launchctl kickstart -k gui/$(id -u)/com.gepa.ai-contents-studio && sleep 8 && tail -n 12 ~/Library/Logs/ai-contents-studio.log`
Expected: `[ai-contents-studio] http://127.0.0.1:8787` 줄이 새로 찍힌다.

- [ ] **Step 4: 자율 틱 1회 수동 실행 + 로그 확인**

대시보드의 수동 틱 버튼(또는 `curl -s -X POST http://127.0.0.1:8787/autonomy/tick`)을 누르고 5~10분 뒤:

Run: `grep -n "\[사실공급\]\|금지모듈\|아이디어 기각(사실 부족 수종)\|사실 부족 재시도" ~/Library/Logs/ai-contents-studio.log | tail -10`
Expected: `[사실공급] "○○" 고유 사실 N건(재배 a·이야기 b) / 검색 결과 M건 / 질의 8개` 와 `작가 다양성 가드 — … 금지모듈 K건(…)` 이 보인다. 런 세션 폴더에 `fact_supply.json` 이 있고 `fact_card.md` 에 `[재배]`/`[이야기]` 줄이 들어갔는지 본다:

Run: `ls -t data/sessions | head -1 | xargs -I{} sh -c 'ls data/sessions/{}/fact_supply.json && grep -c "\[재배\]\|\[이야기\]" data/sessions/{}/fact_card.md'`

- [ ] **Step 5: 사실 부족 경로 1회 확인(선택 — N건 미만이 자연히 나오면 그걸로)**

N건 미만 런이 나오면 로그에 `→ 집필 보류, 주제 교체` 뒤 `사실 부족 재시도` 틱과 새 런이 뜨는지, `data/pieces/index.json` 의 해당 조각에 `factStarved` 가 있는지 확인. 나오지 않으면 `FACT_MIN_SPECIFIC=30` 으로 잠깐 올려 한 번 유도한 뒤 원복(재기동 2회).

- [ ] **Step 6: 커밋 + 메모리**

```bash
git add .env
git commit -m "chore(env): 사실 공급·모듈 로테이션 키 문서화

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012cydZiF9RRFga2ioY4wAir"
```
(`.env` 가 git 추적 밖이면 이 커밋은 생략.) 그리고 사용자 메모리에 "글감 공급·모듈 로테이션 2026-09-17" 항목을 남긴다 — 기준선 수치(묘목 80·잎 진 뒤 78·화분 61·이야기 0%), 관측 명령(`scripts/rotation_report.ts`), 되돌리기 키.
