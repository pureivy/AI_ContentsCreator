/**
 * 로테이션 실측 — 주제 축과 수종이 실제로 퍼졌는지 본다(2026-09-17 규칙 도입 뒤 확인용, API 호출 0회).
 *
 *   pnpm tsx scripts/rotation_report.ts                 → 규칙 도입일(기본) 전후 비교
 *   pnpm tsx scripts/rotation_report.ts 2026-09-17      → 그 날짜를 경계로 비교
 *   pnpm tsx scripts/rotation_report.ts 2026-09-17 14   → 경계 앞뒤를 각 14일로 잘라 비교
 *
 * 쏠림은 '상위 4축이 몇 %를 먹었나'로 잰다 — 축이 24개라 고른 분포면 17% 근처, 한쪽으로 쏠리면 50%를 넘는다.
 * 기준선(2026-09-17 규칙 도입 직전 30일 70편): 상위 4축 51% · 쓴 축 18/24 · 안 쓴 축 6.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../src/config';
import { getBrand, activeBrandSlug } from '../src/content/brand';
import { themeInText } from '../src/content/topicThemes';
import { speciesInText } from '../src/content/speciesRotation';
import { findSpeciesLoose } from '../src/content/species';

const RULES_LIVE = '2026-09-17';   // 최근 축 창·수종 창·지시 우회 제거가 서버에 올라간 날

interface Piece { title: string; keyword?: string; createdTs: string; brand?: string; stage: string }

const themeOf = (t: string): string | null => themeInText(t, getBrand()?.topicThemes);
const speciesOf = (t: string): string | null =>
  findSpeciesLoose(t)?.name ?? speciesInText(t, getBrand()?.speciesCatalog) ?? null;

function load(slug: string): Piece[] {
  const raw = JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, 'pieces', 'index.json'), 'utf-8')) as Piece[];
  return raw
    .filter((p) => (p.brand ?? '') === slug && p.stage !== 'idea' && p.stage !== 'error')
    .sort((a, b) => a.createdTs.localeCompare(b.createdTs));
}

interface Slice { label: string; pieces: Piece[] }

function summarize(s: Slice): string[] {
  const themes = new Map<string, number>();
  const species = new Map<string, number>();
  let noTheme = 0;
  for (const p of s.pieces) {
    const t = `${p.title} ${p.keyword ?? ''}`;
    const th = themeOf(t);
    if (th) themes.set(th, (themes.get(th) ?? 0) + 1); else noTheme++;
    const sp = speciesOf(t);
    if (sp) species.set(sp, (species.get(sp) ?? 0) + 1);
  }
  const themed = [...themes.values()].reduce((a, b) => a + b, 0);
  const top = [...themes.entries()].sort((a, b) => b[1] - a[1]);
  const top4 = top.slice(0, 4).reduce((a, r) => a + r[1], 0);
  const share = themed ? Math.round((top4 / themed) * 100) : 0;
  const allThemes = (getBrand()?.topicThemes ?? []).length;
  const maxSp = Math.max(0, ...species.values());
  const out = [
    `【${s.label}】 ${s.pieces.length}편 (축 분류 ${themed} · 수종 없음/미분류 ${noTheme})`,
    `  쏠림 — 상위 4축이 ${share}%  ${top.slice(0, 4).map(([t, n]) => `${t} ${n}`).join(' · ') || '(없음)'}`,
    `  폭   — 쓴 축 ${themes.size}/${allThemes} · 쓴 수종 ${species.size} · 한 수종 최다 ${maxSp}편`,
  ];
  return out;
}

const [cutArg, winArg] = process.argv.slice(2);
const cut = (cutArg && /^\d{4}-\d{2}-\d{2}$/.test(cutArg) ? cutArg : RULES_LIVE);
const cutMs = new Date(`${cut}T00:00:00`).getTime();
const winDays = Number(winArg) > 0 ? Number(winArg) : 30;
const span = winDays * 86_400_000;

const slug = activeBrandSlug();
const all = load(slug);
const ts = (p: Piece): number => new Date(p.createdTs).getTime();
const before: Slice = { label: `규칙 전 ${winDays}일`, pieces: all.filter((p) => ts(p) < cutMs && ts(p) >= cutMs - span) };
const after: Slice = { label: `규칙 후 (${cut}~)`, pieces: all.filter((p) => ts(p) >= cutMs) };

console.log(`로테이션 실측 — 브랜드 ${slug} · 경계 ${cut}\n`);
for (const line of summarize(before)) console.log(line);
console.log('');
for (const line of summarize(after)) console.log(line);

if (after.pieces.length < 10) {
  console.log(`\n※ 규칙 후 ${after.pieces.length}편 — 표본이 얇다. 하루 2~3편이니 10편은 넘겨야 분포를 말할 수 있다.`);
} else {
  console.log('\n판정 기준: 상위 4축 비중이 내려가고 쓴 축 수가 올라가면 퍼진 것이다.');
}
