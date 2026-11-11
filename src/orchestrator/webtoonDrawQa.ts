/**
 * 웹툰 그림 철저 검수(2026-11-10 사장님 "그릴 때 제대로 그리고, 그린 그림을 철저하게 검수").
 * 감나무 샘플에서 드러난 구멍 세 개를 막는다.
 *  ① 참조 그림 먼저 — 묘목 참조가 손목 굵기·일본풍 마당으로 그려졌고 장면 12장이 다 따라갔다. 장면보다 먼저 본다.
 *  ② 정확한 기준 — 검수가 '어린 나무' 대략 기준이었다. 나무 소품 묘사의 나이를 나이별 크기 기준표(treeAgeSize)로 넘긴다.
 *  ③ 한꺼번에 비교 — 한 장씩 판정은 장면끼리 나무가 달라져도 못 잡는다. 참조 + 나무 장면을 한 번에 놓고 튀는 장을 고른다.
 *  ④ 이유를 붙여 다시 — 탈락 사유를 그 장(또는 참조) 지시에 "Must fix:" 로 붙여 다시 그린다(호출부가 최대 2번).
 */
import fs from 'node:fs';
import path from 'node:path';
import { microJSON } from './agent';
import { stdModel, visionCapable } from './visionCommon';
import { ageSizeCheck, ageSizePrompt } from '../content/treeAgeSize';
import type { Species } from '../content/species';

type Prop = { name?: string; prompt?: string; seed?: number; [k: string]: unknown };
type Scene = { id: string; image?: string; narration?: string; props?: string[]; character?: boolean; [k: string]: unknown };
export type WtShotlist = { scenes: Scene[]; props?: Record<string, Prop>; [k: string]: unknown };

export const TREE_PROP = /sapling|seedling|tree|shrub|vine|whip/i;
export const STAKE_PROP = /stake|pole|support/i;

/** 소품 찾기(순수) — 이름·설명이 패턴에 맞는 첫 소품. 나무 소품이 지주로 오인되지 않게 나무를 먼저 거른다. */
export function findProp(s: WtShotlist, re: RegExp, notRe?: RegExp): { key: string; prop: Prop } | null {
  for (const [key, prop] of Object.entries(s.props ?? {})) {
    const t = `${key} ${prop.name ?? ''}`;
    if (re.test(t) && !(notRe && notRe.test(t))) return { key, prop };
  }
  return null;
}

/** 나무 소품 묘사에 나이별 크기 기준표 줄을 붙인다(순수, 한 번만). 그림이 같은 표를 따르게. */
export function pinTreeSize(s: WtShotlist, sp?: Pick<Species, 'name' | 'latin' | 'type' | 'size'>): { shotlist: WtShotlist; changed: boolean } {
  const t = findProp(s, TREE_PROP);
  if (!t) return { shotlist: s, changed: false };
  const cur = String(t.prop.prompt ?? '');
  if (cur.includes('[Tree size for its age')) return { shotlist: s, changed: false };
  const line = ageSizePrompt(cur, sp, { english: true }); // 그림 필드는 영어만(lint)
  if (!line) return { shotlist: s, changed: false };
  return { shotlist: { ...s, props: { ...s.props, [t.key]: { ...t.prop, prompt: `${cur} ${line}` } } }, changed: true };
}

const FIX = /\s*Must fix: .*$/s;
/** 고칠 점 붙이기(순수) — 앞서 붙인 "Must fix:" 는 바꾼다(쌓이지 않게). 그림 필드는 영어지만 사유는 한국어여도 그림 모델이 읽는다. */
export function withFix(text: string, reason: string): string {
  // 그림 필드는 영어만(SHORT_marker lint) — 번역(englishFixes)을 못 거친 한글 사유는 일반 문구로 바꾼다(2026-11-10 으름 웹툰 실패).
  const r = /[가-힣]/.test(reason) ? 'match the described size, thickness, form and Korean setting exactly' : reason;
  return `${String(text ?? '').replace(FIX, '').trim()} Must fix: ${r.replace(/\s+/g, ' ').slice(0, 240)}`;
}

/**
 * 검수 사유(한국어) → 그림 모델에 줄 영어 고칠 점(2026-11-10). 한 번에 묶어 번역한다. 실패하면 원문 그대로(withFix 가 일반 문구로 바꾼다).
 * 예: "기준은 손가락 굵기인데 팔뚝 굵기, 흰 바탕이 아니라 마당" → "the stem must be finger-thin, not forearm-thick; plain white background, no yard".
 */
const TEXT_FINDING = /잡글자|글자|간판|팻말|표지/;
export const NO_SIGN = 'No signs, signboards, plaques, labels or writing anywhere in the scene; walls, posts and fences are plain.';
export async function englishFixes(reasons: Record<string, string>, signal?: AbortSignal): Promise<Record<string, string>> {
  const keys = Object.keys(reasons);
  if (!keys.length || !visionCapable()) return reasons;
  const r = await microJSON<Record<string, unknown>>(stdModel(), 'You turn Korean image-review findings into short English drawing corrections.',
    ['Rewrite each finding as ONE short English instruction for an image model saying what the picture MUST look like (the target, not the mistake), keeping the sizes and comparisons the finding states (e.g. finger-thin, chest-high, plain white background). Describe only the wanted look in positive words: never name the mistake, not even negated (no \"no flared roots\", \"not thick\", \"without X\") — an image model draws whatever is named (2026-11-11: \"no flared roots\" in every fix gave flared roots in all 11 scenes); write e.g. \"the trunk goes straight into the soil like a post\". Add nothing the finding does not say — no new setting, wall or object (2026-11-10: an example \"Korean stone wall\" leaked into a white-background fix). For a text or signboard finding never ask for a sign (not even a blank one) — say there are no signs, signboards, plaques or writing anywhere. No Korean characters. Max 30 words each.',
      JSON.stringify(reasons), 'JSON: {"<same key>": "instruction"}'].join('\n'),
    { maxOutputTokens: 600, ...(signal ? { signal } : {}) }).catch(() => null);
  const out: Record<string, string> = { ...reasons };
  for (const k of keys) { const v = r?.[k]; if (typeof v === 'string' && v.trim() && !/[가-힣]/.test(v)) out[k] = v.trim(); }
  // 잡글자 지적(2026-11-10 으름 s06) — 번역이 'Show a plain sign with no visible text' 로 팻말을 오히려 그리게 시켰다. 고정 문구를 붙인다.
  for (const k of keys) if (TEXT_FINDING.test(reasons[k]!) && !out[k]!.includes(NO_SIGN)) out[k] = `${out[k]!.replace(/[^.;]*\bsign\b[^.;]*[.;]?/gi, '').trim()} ${NO_SIGN}`.trim();
  return out;
}

/** 탈락 장면에 사유 붙이기(순수). */
export function fixScenes(s: WtShotlist, reasons: Record<string, string>): WtShotlist {
  return { ...s, scenes: s.scenes.map((sc) => (reasons[sc.id] ? { ...sc, image: withFix(String(sc.image ?? ''), reasons[sc.id]!) } : sc)) };
}

/** 탈락 참조 고치기(순수) — 사유를 붙이고 시드를 바꾼다(같은 시드면 같은 그림). */
export function fixProp(s: WtShotlist, key: string, reason: string): WtShotlist {
  const p = s.props?.[key];
  if (!p) return s;
  return { ...s, props: { ...s.props, [key]: { ...p, prompt: withFix(String(p.prompt ?? ''), reason), seed: (typeof p.seed === 'number' ? p.seed : 11) + 1 } } };
}

const OUTDOOR = /yard|garden|field|orchard|backyard|outdoor|nursery|farm/i;
/** 장면별 '나오면 안 되는 것'(순수) — 한국 배경·둥근 지주. qaSceneImages 의 sceneMust 로. */
export function sceneMusts(s: WtShotlist, stakeKey?: string): Array<{ show: string[]; not: string[] }> {
  return s.scenes.map((sc) => {
    const img = String(sc.image ?? '');
    const not: string[] = [];
    if (OUTDOOR.test(img)) not.push('한국이 아닌 배경 — 판자 울타리, 일본식 집·툇마루, 서양 교외 주택(배경은 한국 시골: 돌담·블록담, 함석·기와 지붕 단층집, 장독대)');
    if ((stakeKey && (sc.props ?? []).includes(stakeKey)) || /\bstake\b/i.test(img)) not.push('네모난 각목·대패질한 나무 기둥 지주(지주는 엄지 굵기의 둥근 초록 피복 쇠 지주대나 대나무)');
    not.push('글자·숫자·간판·화살표 글씨');
    return { show: [], not };
  });
}

/** 나무 소품의 나이 기준(순수, 한국어) — 검수에 넘길 정확한 크기. 나이 말이 없으면 ''. */
export function treeAgeCriterion(s: WtShotlist, sp?: Pick<Species, 'name' | 'latin' | 'type' | 'size'>): string {
  const t = findProp(s, TREE_PROP);
  return t ? ageSizeCheck(String(t.prop.prompt ?? ''), sp) : '';
}

type Verdict = { ok?: unknown; problem?: unknown };

/** 지주 참조 한 장 판정 — 둥근 얇은 지주·흰 바탕. 실패·판정 불가는 통과(무해). 나무는 judgeTreeRef(관찰값). */
async function judgeStakeRef(file: string, desc: string, signal?: AbortSignal): Promise<string | null> {
  if (!visionCapable() || !fs.existsSync(file)) return null;
  const lines = [
    `이 그림은 어린 나무 지주 참조 그림이다. 의도: "${desc.slice(0, 300)}"`,
    '판정 항목: 1) 단면이 네모난 각목·대패질한 나무 기둥·울타리 말뚝인가(둥근 초록 피복 쇠 지주대나 대나무여야 한다) 2) 엄지보다 눈에 띄게 굵은가 3) 배경이 흰 바탕이 아닌가(밑동의 작은 흙더미는 그리라고 시킨 것이라 괜찮다 — 마당·담·집·풀밭이 있을 때만 탈락).',
  ];
  const r = await microJSON<Verdict>(stdModel(), '너는 그림 검수자다. 기준에 어긋나는 것만 짧게 지적한다.',
    [...lines.filter(Boolean), '하나라도 어긋나면 ok=false, problem 에 무엇이 어떻게 다른지(기준과 그림 비교) 한 줄. 모두 맞으면 ok=true. JSON: {"ok":true|false,"problem":"..."}'].join('\n'),
    { maxOutputTokens: 300, visionPaths: [file], ...(signal ? { signal } : {}) }).catch(() => null);
  if (!r || r.ok !== false) return null;
  return String(r.problem ?? '기준과 다름').slice(0, 200);
}

/** 나무 참조 관찰값 → 판정(순수, 2026-11-11). 흰 바탕에선 비교할 물건이 없어 절대 굵기(팔뚝·허벅지)는 보지 않는다 — 장면 검수가 맡는다. */
export type TreeRefObs = { flare?: unknown; stems?: unknown; background?: unknown; trees?: unknown; leafType?: unknown; note?: unknown };
export function treeRefVerdict(o: TreeRefObs, desc: string): string | null {
  const bad: string[] = [];
  if (o.flare === 'strong') bad.push('밑동에 노목처럼 퍼진 뿌리·부푼 밑동');
  const single = /\bsingle\b[^.,;]{0,30}\b(?:trunk|stem|whip)\b|\bwhip\b/i.test(desc) && !/shrub|bush|multi-?stem/i.test(desc);
  const stems = Number(o.stems);
  if (single && Number.isFinite(stems) && stems > 1) bad.push(`흙에서 줄기 ${stems}개가 올라옴(외줄기여야 함)`);
  if (o.background === 'scene') bad.push('흰 바탕이 아니라 마당·담·집이 그려짐');
  const trees = Number(o.trees);
  if (Number.isFinite(trees) && trees > 1) bad.push(`나무가 ${trees}그루`);
  if (o.leafType === 'wrong') bad.push(`잎 모양이 실물과 다름${o.note ? `: ${String(o.note).slice(0, 80)}` : ''}`);
  return bad.length ? bad.join(', ') : null;
}

/** 관찰값 합치기(순수) — 모두가 같은 지적일 때만(한 번뿐인 엉뚱한 지적은 버린다). 2026-11-11 재보정: '밑동은 한 번이라도 strong'은
 * 곧은 1년생 묘목까지 15번 중 14번 떨어뜨렸다 — 참조에서 멈추면 편 전체가 멈춘다. 놓친 밑동은 장면 검수의 '참조로 돌아가기'가 잡는다. */
export function mergeTreeObs(obs: readonly TreeRefObs[]): TreeRefObs {
  const all = <K extends keyof TreeRefObs>(k: K, v: unknown): boolean => obs.every((o) => o[k] === v);
  const minNum = (k: 'stems' | 'trees'): number => Math.min(...obs.map((o) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 1)));
  return {
    flare: all('flare', 'strong') ? 'strong' : obs.some((o) => o.flare !== 'none') ? 'slight' : 'none',
    stems: minNum('stems'), trees: minNum('trees'),
    background: all('background', 'scene') ? 'scene' : 'white',
    leafType: all('leafType', 'wrong') ? 'wrong' : 'ok',
    note: obs.find((o) => o.leafType === 'wrong')?.note,
  };
}

/**
 * 나무 참조 판정(2026-11-11 감나무) — 자유 서술 판정은 같은 그림을 한 번은 통과, 한 번은 탈락시켰고(옛 참조가 통과해 장면 11장이
 * 따라감), 고친 참조는 곧은 밑동인데도 '허벅지 굵기·판근'으로 떨어뜨렸다. 흰 바탕에서 보이는 것만 관찰값으로 받고 판정은 코드가 한다.
 * 호출 실패는 한 번 더 묻고, 그래도 실패면 통과(무해)하되 로그를 남긴다 — 실패를 '이상 없음'으로 숨기지 않는다.
 */
async function judgeTreeRef(file: string, desc: string, signal?: AbortSignal, truth: readonly string[] = []): Promise<string | null> {
  if (!visionCapable() || !fs.existsSync(file)) return null;
  const prompt = [
    `이 그림은 웹툰 장면들이 따라 그릴 나무 참조 그림(흰 바탕)이다. 의도한 나무: "${desc.slice(0, 300)}"`,
    '보이는 것만 관찰해 적어라(판정하지 마라).',
    'flare: 줄기가 흙에 들어가는 곳 — "none"(말뚝처럼 곧게 들어감) / "slight"(살짝 넓어짐·흙더미에 잔뿌리 한두 개) / "strong"(뿌리가 문어발처럼 사방으로 퍼지거나 밑동이 줄기보다 확 부풂).',
    'stems: 흙에서 올라오는 줄기 개수(땅 위에서 갈라지는 가지는 세지 마라).',
    'background: "white"(흰 바탕, 밑동의 작은 흙더미는 괜찮다) / "scene"(마당·담·집·풀밭이 그려짐).',
    'trees: 그루 수.',
    truth.length ? 'leafType: 첨부 2번째부터는 이 수종의 실물 사진이다. 잎이 겹잎/홑잎, 잎차례, 전체 윤곽에서 실물과 다르면 "wrong", 같으면 "ok". 웹툰식 단순화(잎맥 생략·같은 모양 반복·색 단순화)는 "ok"다.' : 'leafType: "ok".',
    'JSON: {"flare":"none|slight|strong","stems":1,"background":"white|scene","trees":1,"leafType":"ok|wrong","note":"leafType 이 wrong 일 때 한 줄"}',
  ].join('\n');
  // 두 번 관찰해 둘 다 같은 지적일 때만 탈락(mergeTreeObs) — 한 번 관찰은 같은 그림에서도 흔들렸다.
  const ask = async (): Promise<TreeRefObs | null> => {
    for (let i = 0; i < 2; i++) {
      const r = await microJSON<TreeRefObs>(stdModel(), '너는 그림을 보고 관찰값만 적는 검수 보조다.', prompt,
        { maxOutputTokens: 200, visionPaths: [file, ...truth], ...(signal ? { signal } : {}) }).catch(() => null);
      if (r && typeof r.flare === 'string') return r;
    }
    return null;
  };
  const obs = (await Promise.all([ask(), ask()])).filter((o): o is TreeRefObs => !!o);
  if (obs.length) return treeRefVerdict(mergeTreeObs(obs), desc);
  console.log('[웹툰] 참조 나무 판정 실패(두 번) — 판정 없이 진행');
  return null;
}

export async function judgeRef(file: string, kind: 'tree' | 'stake', desc: string, criterion: string, signal?: AbortSignal, truth: readonly string[] = []): Promise<string | null> {
  return kind === 'tree' ? judgeTreeRef(file, desc, signal, truth) : judgeStakeRef(file, desc, signal);
}

/** 텔레그램 요약(순수, 2026-11-11 사장님) — 남은 문제를 종류별 장 수로 한 줄. 예: "나무 크기·나이 7장 · 손 5장 · 배경 2장". */
const QA_KINDS: Array<[string, RegExp]> = [
  ['손', /손[:：]|손가락이|엄지가/], ['배경', /배경|일본|가옥|주택|울타리/], ['글자', /글자|간판|팻말/],
  ['계절', /계절|잎 상태/], ['나무 크기·나이', /나이|굵기|판근|뿌리|일관성|밑동|높이/], ['잎·수종 모양', /잎|수종|꽃|열매/],
];
export function summarizeDrawQa(items: readonly string[]): string {
  const by = new Map<string, Set<string>>();
  for (const it of items) {
    const scene = /^(?:씬|장면\s*)(\d+)|^s(\d+)/.exec(it.trim());
    const sid = scene ? String(Number(scene[1] ?? scene[2])) : it;
    const kind = QA_KINDS.find(([, re]) => re.test(it))?.[0] ?? '기타';
    if (!by.has(kind)) by.set(kind, new Set());
    by.get(kind)!.add(sid);
  }
  return [...by.entries()].sort((a, b) => b[1].size - a[1].size).map(([k, v]) => `${k} ${v.size}장`).join(' · ');
}

/**
 * ③ 같은 나무 비교 — 첫 장은 참조, 나머지는 나무가 나오는 장면. 사람·지주·돌담 대비 키·굵기·가지 수가 참조 묘사와 눈에 띄게 다르거나
 * 장면끼리 서로 다른 나무로 보이는 장을 고른다. 반환은 장면 순번(0-base, scenes 배열 기준) → 사유.
 */
export async function judgeTreeConsistency(refFile: string, scenes: ReadonlyArray<{ file: string; hint: string }>, desc: string, criterion: string, signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!visionCapable() || !fs.existsSync(refFile) || scenes.length < 2) return out;
  const list = scenes.slice(0, 11);
  const r = await microJSON<{ issues?: Array<{ scene?: unknown; problem?: unknown }> }>(stdModel(), '너는 웹툰 연속성 검수자다. 같은 나무가 장면마다 같은 크기·모양인지 본다.',
    [
      `첨부 1번째는 나무 참조 그림, 2~${list.length + 1}번째는 장면 그림이다. 모든 장면의 나무는 참조와 같은 한 그루다: "${desc.slice(0, 300)}"`,
      criterion ? `나이별 기준 크기: ${criterion}` : '',
      '장면마다 나무의 키(사람 어른 약 1.6~1.7m·지주·돌담 대비), 줄기 굵기(손가락·엄지·손목 대비), 가지 수, 모양을 참조·기준과 비교하라. 접사(줄기만 크게)·땅속 단면 장면은 굵기만 본다. 계절에 따른 잎·새순 차이는 문제 아니다.',
      '눈에 띄게 크거나 굵거나 가지가 많거나 다른 나무로 보이는 장만 보고하라. scene 은 장면 순번(2번째 첨부 = 1).',
      ...list.map((x, k) => `${k + 1}) ${x.hint.slice(0, 60)}`),
      'JSON: {"issues":[{"scene":1,"problem":"한 줄 — 기준과 그림 비교"}]} 문제 없으면 빈 배열.',
    ].filter(Boolean).join('\n'),
    { maxOutputTokens: 700, visionPaths: [refFile, ...list.map((x) => x.file)], ...(signal ? { signal } : {}) }).catch(() => null);
  for (const x of Array.isArray(r?.issues) ? r!.issues : []) {
    const k = Math.floor(Number(x?.scene)) - 1;
    if (k >= 0 && k < list.length && !out.has(k)) out.set(k, `나무 일관성: ${String(x?.problem ?? '참조와 다름').slice(0, 180)}`);
  }
  return out;
}
