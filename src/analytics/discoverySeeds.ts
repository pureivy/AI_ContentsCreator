/**
 * 발굴 시드 회전(2026-08-27) — 자동완성·유튜브·수요 스냅샷이 전부 brandSeedKeywords(21개, 10종 안팎)만
 * 시드로 써서 발굴 폭이 시간이 갈수록 좁아졌다(사용자: "검색 후 다양한 주제를 잡아야지, 주제의 폭이 좁아진다").
 * 수종 카탈로그에서 '최근 30일 안 다룬 수종'을 날짜로 회전시켜 시드로 쓰고, 월 상한 수종은 뺀다.
 * 카탈로그가 없으면 종전대로 브랜드 시드(동작 불변).
 */
import { activeBrandSlug, brandSeedKeywords, getBrand } from '../content/brand';
import { pieceStore } from '../content/pieces';
import { speciesCoverage, SPECIES_MONTHLY_CAP, type SpeciesGroup } from '../content/speciesRotation';

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000);
}

/** 순수 — 카탈로그·편수·날짜로 시드 목록을 만든다(테스트 대상). */
export function pickDiscoverySeeds(a: {
  catalog: SpeciesGroup[] | undefined; coverage: Map<string, number>; brandSeeds: string[];
  max: number; now?: Date; keepBrand?: number; cap?: number;
}): string[] {
  const max = Math.max(1, a.max);
  const flat = (a.catalog ?? []).flatMap((g) => g.species ?? []).map((s) => s.name).filter(Boolean);
  if (!flat.length) return a.brandSeeds.slice(0, max);
  const cap = a.cap ?? SPECIES_MONTHLY_CAP;
  const fresh = flat.filter((n) => (a.coverage.get(n) ?? 0) === 0);
  const recent = flat.filter((n) => { const c = a.coverage.get(n) ?? 0; return c > 0 && c < cap; });
  const pool = [...fresh, ...recent];                       // 상한 도달 수종은 시드에서 제외
  const keep = Math.min(a.keepBrand ?? 2, a.brandSeeds.length, Math.max(0, max - 1));
  const nSpecies = Math.max(1, max - keep);
  const doy = dayOfYear(a.now ?? new Date());
  const out: string[] = [];
  if (pool.length) {
    const off = doy % pool.length;
    for (let i = 0; i < Math.min(nSpecies, pool.length); i++) out.push(pool[(off + i) % pool.length]!);
  }
  if (keep && a.brandSeeds.length) {
    const off = doy % a.brandSeeds.length;
    for (let i = 0; i < a.brandSeeds.length && out.length < max; i++) {
      const s = a.brandSeeds[(off + i) % a.brandSeeds.length]!;
      if (!out.includes(s)) out.push(s);
      if (out.filter((x) => a.brandSeeds.includes(x)).length >= keep) break;
    }
  }
  return out.slice(0, max);
}

/** 자동완성이 돌려준 구절이 원예·나무 주제처럼 보이는가(순수) — "대추나무 사랑걸렸네"·"대추나무집"·"한의원" 류 잡음 제거. */
const GARDEN_INTENT_RE = /묘목|심기|심는|식재|키우기|기르기|재배|가지치기|전정|순지르기|물주기|관수|비료|거름|시비|병충해|병해|벌레|약|꽃|열매|수확|가격|종류|품종|관리|월동|삽목|접목|번식|잎|뿌리|분갈이|화분|베란다|정원|조경|전지|개화|낙엽|단풍|생육|성장|크기|간격|심을|고르|선택|추천|시기|방법/;
export function looksLikeGardenQuery(q: string): boolean {
  return GARDEN_INTENT_RE.test((q ?? '').replace(/\s+/g, ''));
}

/** 브랜드의 30일 수종별 편수(부작용: pieces 읽기) — 시드 회전·수요 winners 필터 공용. */
export function brandSpeciesCoverage(now = new Date(), slug = activeBrandSlug() || ''): Map<string, number> {
  try {
    const items = pieceStore().list()
      .filter((p) => (p.brand ?? '') === slug && p.stage !== 'idea' && p.stage !== 'error')
      .map((p) => ({ title: p.title, keyword: p.keyword, ts: p.createdTs }));
    return speciesCoverage(items, getBrand()?.speciesCatalog, now);
  } catch { return new Map(); }
}

/** 활성 브랜드 기준 시드(부작용: pieces 읽기). */
export function discoverySeeds(max: number, now = new Date(), slug = activeBrandSlug() || ''): string[] {
  const b = getBrand();
  return pickDiscoverySeeds({ catalog: b?.speciesCatalog, coverage: brandSpeciesCoverage(now, slug), brandSeeds: brandSeedKeywords(b), max, now });
}
