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
