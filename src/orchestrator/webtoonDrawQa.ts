/**
 * 웹툰 그림 철저 검수(2026-11-10 사장님 "그릴 때 제대로 그리고, 그린 그림을 철저하게 검수").
 * 감나무 샘플에서 드러난 구멍 세 개를 막는다.
 *  ① 참조 그림 먼저 — 묘목 참조가 손목 굵기·일본풍 마당으로 그려졌고 장면 12장이 다 따라갔다. 장면보다 먼저 본다.
 *  ② 정확한 기준 — 검수가 '어린 나무' 대략 기준이었다. 나무 소품 묘사의 나이를 나이별 크기 기준표(treeAgeSize)로 넘긴다.
 *  ③ 한꺼번에 비교 — 한 장씩 판정은 장면끼리 나무가 달라져도 못 잡는다. 참조 + 나무 장면을 한 번에 놓고 튀는 장을 고른다.
 *  ④ 이유를 붙여 다시 — 탈락 사유를 그 장(또는 참조) 지시에 "Must fix:" 로 붙여 다시 그린다(호출부가 최대 2번).
 */
import fs from 'node:fs';
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
  return `${String(text ?? '').replace(FIX, '').trim()} Must fix: ${reason.replace(/\s+/g, ' ').slice(0, 220)}`;
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

/** ① 참조 그림 한 장 판정 — 나무: 기준 크기·흰 배경 단독·퍼진 뿌리 없음 / 지주: 둥근 얇은 지주. 실패·판정 불가는 통과(무해). */
export async function judgeRef(file: string, kind: 'tree' | 'stake', desc: string, criterion: string, signal?: AbortSignal): Promise<string | null> {
  if (!visionCapable() || !fs.existsSync(file)) return null;
  const lines = kind === 'tree'
    ? [
      `이 그림은 웹툰 장면들이 따라 그릴 나무 참조 그림이다. 의도한 나무: "${desc.slice(0, 400)}"`,
      criterion ? `나이별 기준 크기(이것으로 판정): ${criterion}` : '',
      '판정 항목: 1) 줄기 굵기가 기준보다 눈에 띄게 굵은가(예: 손가락 굵기여야 하는데 손목 굵기) 2) 가지 수·모양이 기준과 다른가(외줄기여야 하는데 가지가 여럿) 3) 밑동에 노목처럼 퍼진 뿌리·부푼 밑동이 있는가 4) 배경이 흰 바탕이 아니라 마당·울타리·집이 그려졌는가 5) 나무가 한 그루가 아닌가.',
      '흰 바탕이라 키는 줄기 굵기 대비 길이(가늘고 긴 외줄기인지)로 가늠하라.',
    ]
    : [
      `이 그림은 어린 나무 지주 참조 그림이다. 의도: "${desc.slice(0, 300)}"`,
      '판정 항목: 1) 단면이 네모난 각목·대패질한 나무 기둥·울타리 말뚝인가(둥근 초록 피복 쇠 지주대나 대나무여야 한다) 2) 엄지보다 눈에 띄게 굵은가 3) 배경이 흰 바탕이 아닌가.',
    ];
  const r = await microJSON<Verdict>(stdModel(), '너는 그림 검수자다. 기준에 어긋나는 것만 짧게 지적한다.',
    [...lines.filter(Boolean), '하나라도 어긋나면 ok=false, problem 에 무엇이 어떻게 다른지(기준과 그림 비교) 한 줄. 모두 맞으면 ok=true. JSON: {"ok":true|false,"problem":"..."}'].join('\n'),
    { maxOutputTokens: 300, visionPaths: [file], ...(signal ? { signal } : {}) }).catch(() => null);
  if (!r || r.ok !== false) return null;
  return String(r.problem ?? '기준과 다름').slice(0, 200);
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
