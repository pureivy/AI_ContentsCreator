/**
 * 브랜드(고객사) 프로필 — 이 스튜디오가 '누구를 위해' 콘텐츠를 만드는지 정의하는 계층.
 *
 * company.yaml(AI 직원 조직)과 별개다: 직원은 범용 스킬을 갖고, 브랜드는 런타임 컨텍스트로
 * 주입된다 — 그래야 기업 전환이 프롬프트 수정 없이 데이터(brand.yaml) 교체만으로 된다.
 *
 * 파일이 없으면 null(미설정) — 모든 주입 지점이 빈 문자열을 받아 기존 동작 100% 불변.
 * 인스턴스 분리(GEPA_DATA_DIR 스왑) 시 brand.yaml 도 데이터 디렉토리를 따라간다.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG } from '../config';

export interface BrandProduct {
  name: string;
  /** 특징·강점 한 줄(콘텐츠에 녹일 셀링 포인트). */
  features?: string;
  /** 이 제품의 타겟 고객(전체 타겟과 다르면). */
  target?: string;
}

export interface BrandProfile {
  /** 업체명(필수). */
  name: string;
  industry?: string;
  /** 한 줄 소개 — 무엇을 하는 회사인가. */
  description?: string;
  products: BrandProduct[];
  /** 타겟 고객(연령·상황·니즈). */
  audience?: string;
  /** 지역(로컬 비즈니스면 상권·배달권 등). */
  region?: string;
  /** 톤앤매너(예: 친근한 존댓말, 전문적, 유머러스). */
  tone?: string;
  /** 금지 표현·다루지 않을 주제. */
  banned?: string[];
  /** 시드 키워드 — 성과 데이터가 없는 콜드스타트 주제 탐색의 출발점. */
  seedKeywords?: string[];
  /** 채널 설명(예: 네이버 블로그 — 제품 활용 하우투·후기 중심). */
  channel?: string;
}

const brandPath = (): string => path.join(CONFIG.dataDir, 'brand.yaml');
const brandsDir = (): string => path.join(CONFIG.dataDir, 'brands');

let _cached: BrandProfile | null | undefined; // undefined=미로드, null=파일 없음/무효

export function reloadBrand(): void { _cached = undefined; }

/** 브랜드명 → 파일/태깅용 슬러그(결정적) — new_studio.mjs 와 동일 규칙. */
export function brandSlug(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'brand';
}

/**
 * 슬러그 안전 검증 — brandSlug() 가 생성 가능한 문자만(유니코드 문자·숫자·하이픈, 64자 캡).
 * 외부 입력(POST /brands/activate)·영속 데이터(piece.brand)가 파일 경로에 닿기 전의 관문:
 * '.'·'/'·'\' 가 문자 집합에 없어 경로 탈출(path traversal)이 원천 차단된다.
 */
export function isSafeBrandSlug(slug: string): boolean {
  return /^[\p{L}\p{N}-]{1,64}$/u.test(slug);
}

/** 현재 활성 브랜드의 슬러그 — 콘텐츠(pieces·cardnews·shorts) 태깅·필터의 기준. 범용 모드면 ''. */
export function activeBrandSlug(): string {
  const b = getBrand();
  return b ? brandSlug(b.name) : '';
}

/** 슬러그 → 브랜드 파일 접미(순수). undefined/''(범용) → ''. */
export function brandFileSuffixFor(slug: string | undefined): string {
  return slug ? `-${slug}` : '';
}
export function brandFileSuffix(): string { return brandFileSuffixFor(activeBrandSlug()); }

/** 브랜드 프로필 로드(캐시) — 없거나 name 이 비면 null(미설정). */
export function getBrand(): BrandProfile | null {
  if (_cached !== undefined) return _cached;
  try {
    const raw = YAML.parse(fs.readFileSync(brandPath(), 'utf-8')) as Partial<BrandProfile> | null;
    _cached = normalizeBrand(raw);
  } catch { _cached = null; }
  return _cached;
}

/** 저장(원자적 교체) + 캐시 무효화 — 활성(brand.yaml)과 레지스트리(brands/<slug>.yaml)에 함께 기록. */
export function saveBrand(b: BrandProfile): void {
  const norm = normalizeBrand(b);
  if (!norm) return;
  const text = YAML.stringify(norm);
  fs.mkdirSync(brandsDir(), { recursive: true });
  const tmp = `${brandPath()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, brandPath());
  fs.writeFileSync(path.join(brandsDir(), `${brandSlug(norm.name)}.yaml`), text, 'utf-8');
  reloadBrand();
}

/** 저장된 브랜드 목록(레지스트리) — 활성 brand.yaml 이 레지스트리에 없으면 자동 이관(하위 호환). */
export function listBrands(): Array<{ slug: string; name: string; industry?: string }> {
  const active = getBrand();
  if (active && !fs.existsSync(path.join(brandsDir(), `${brandSlug(active.name)}.yaml`))) saveBrand(active);
  let files: string[] = [];
  try { files = fs.readdirSync(brandsDir()).filter((f) => f.endsWith('.yaml')); } catch { /* 없음 */ }
  const out: Array<{ slug: string; name: string; industry?: string }> = [];
  for (const f of files) {
    try {
      const b = normalizeBrand(YAML.parse(fs.readFileSync(path.join(brandsDir(), f), 'utf-8')));
      if (b) out.push({ slug: f.replace(/\.yaml$/, ''), name: b.name, industry: b.industry });
    } catch { /* 무효 파일 스킵 */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/**
 * 브랜드 전환 — slug 지정 시 레지스트리에서 활성(brand.yaml)으로 복사, null 이면 범용 모드(활성 해제).
 * 주입부(buildSystemPrompt 등)는 계속 brand.yaml 만 읽으므로 전환 즉시 다음 런부터 반영된다.
 */
export function activateBrand(slug: string | null): BrandProfile | null {
  if (!slug) {
    try { fs.rmSync(brandPath()); } catch { /* 이미 없음 */ }
    reloadBrand();
    return null;
  }
  if (!isSafeBrandSlug(slug)) throw new Error(`무효한 슬러그: ${slug}`);
  // 심층 방어 — 검증을 통과했더라도 최종 경로가 brands/ 안인지 재확인.
  const src = path.resolve(brandsDir(), `${slug}.yaml`);
  if (!src.startsWith(path.resolve(brandsDir()) + path.sep)) throw new Error(`무효한 슬러그: ${slug}`);
  const b = normalizeBrand(YAML.parse(fs.readFileSync(src, 'utf-8'))); // 없으면 throw — 호출부가 404 처리
  if (!b) throw new Error(`무효한 브랜드 파일: ${slug}`);
  fs.copyFileSync(src, brandPath());
  reloadBrand();
  return getBrand();
}

/**
 * 브랜드 삭제 — 레지스트리에서 제거(원본은 brands/.trash/ 로 이동해 복구 여지 보존).
 * 활성 브랜드였다면 범용 모드로 전환. 콘텐츠·성과 파일은 건드리지 않는다(비파괴) —
 * 같은 이름으로 브랜드를 다시 만들면 태그가 같은 슬러그라 자료가 그대로 복귀한다.
 */
export function deleteBrand(slug: string): boolean {
  if (!isSafeBrandSlug(slug)) throw new Error(`무효한 슬러그: ${slug}`);
  const file = path.resolve(brandsDir(), `${slug}.yaml`);
  if (!file.startsWith(path.resolve(brandsDir()) + path.sep)) throw new Error(`무효한 슬러그: ${slug}`);
  if (!fs.existsSync(file)) return false;
  const trash = path.join(brandsDir(), '.trash');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(file, path.join(trash, `${slug}-${Date.now()}.yaml`));
  if (activeBrandSlug() === slug) {
    try { fs.rmSync(brandPath()); } catch { /* 이미 없음 */ }
    reloadBrand();
  }
  return true;
}

/** 입력 정규화(순수) — name 없으면 null. 문자열 트림·배열 필터·길이 캡(프롬프트 폭주 방지). */
export function normalizeBrand(raw: Partial<BrandProfile> | null | undefined): BrandProfile | null {
  const name = String(raw?.name ?? '').trim().slice(0, 60);
  if (!name) return null;
  const s = (v: unknown, cap: number): string | undefined => {
    const t = String(v ?? '').trim().slice(0, cap);
    return t || undefined;
  };
  const arr = (v: unknown, cap: number, itemCap = 40): string[] =>
    (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().slice(0, itemCap)).filter(Boolean).slice(0, cap);
  const products = (Array.isArray(raw?.products) ? raw!.products : [])
    .map((p) => ({
      name: String((p as BrandProduct)?.name ?? '').trim().slice(0, 60),
      features: s((p as BrandProduct)?.features, 200),
      target: s((p as BrandProduct)?.target, 120),
    }))
    .filter((p) => p.name)
    .slice(0, 12);
  return {
    name,
    industry: s(raw?.industry, 60),
    description: s(raw?.description, 300),
    products,
    audience: s(raw?.audience, 200),
    region: s(raw?.region, 100),
    tone: s(raw?.tone, 200),
    banned: arr(raw?.banned, 20, 60),
    seedKeywords: arr(raw?.seedKeywords, 30),
    channel: s(raw?.channel, 200),
  };
}

/**
 * 주입용 [브랜드 컨텍스트] 블록(순수) — buildSystemPrompt·microJSON 직행 지점들이 공용.
 * 미설정이면 '' (모든 호출부가 빈 문자열을 안전 처리 → 기존 동작 불변).
 */
export function brandContext(b: BrandProfile | null = getBrand()): string {
  if (!b) return '';
  const lines: string[] = [
    `[브랜드 컨텍스트 — 이 스튜디오는 아래 기업의 콘텐츠를 만든다]`,
    `업체: ${b.name}${b.industry ? ` (${b.industry})` : ''}${b.region ? ` · ${b.region}` : ''}`,
  ];
  if (b.description) lines.push(`소개: ${b.description}`);
  if (b.products.length) {
    lines.push('주요 제품/서비스:');
    for (const p of b.products) {
      lines.push(`- ${p.name}${p.features ? ` — ${p.features}` : ''}${p.target ? ` (타겟: ${p.target})` : ''}`);
    }
  }
  if (b.audience) lines.push(`타겟 고객: ${b.audience}`);
  if (b.channel) lines.push(`채널: ${b.channel}`);
  if (b.tone) lines.push(`톤앤매너: ${b.tone}`);
  if (b.banned?.length) lines.push(`금지: ${b.banned.join(' · ')}`);
  lines.push('콘텐츠는 독자에게 유용한 정보가 우선이며, 제품은 자연스러운 맥락에서만 연결한다(노골적 광고 금지).');
  return lines.join('\n');
}

/** 제품 라인 이름 목록 — subNiche 를 제품 라인으로 제약(성과 EWMA = 제품 라인별 학습)할 때 사용. */
export function brandProductLines(b: BrandProfile | null = getBrand()): string[] {
  return (b?.products ?? []).map((p) => p.name);
}

/** 콜드스타트 시드 키워드 — 성과 winners 가 비었을 때 주제 탐색 출발점. */
export function brandSeedKeywords(b: BrandProfile | null = getBrand()): string[] {
  return b?.seedKeywords ?? [];
}
