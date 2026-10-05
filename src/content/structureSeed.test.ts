import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config';
import {
  pickStructureSeed, structureBlock, currentStructureSeed, resolveStructureSeed, inheritStructureSeed,
  FIXED_STRUCTURE_SEED, STRUCTURE_KEEP_BLOCK, TITLE_FORM_TEXT, type StructureSeed,
} from './structureSeed';

// CONFIG 는 런타임 가변 객체(readonly 는 타입 힌트일 뿐) — 킬스위치·세션 경로를 강제하고 복원한다.
const cfg = CONFIG as unknown as { structureVariety: boolean; sessionsDir: string };
let origVariety: boolean;
let origSessions: string;
let tmpDir = '';
beforeEach(() => {
  origVariety = cfg.structureVariety;
  origSessions = cfg.sessionsDir;
  cfg.structureVariety = true;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structure-seed-'));
  cfg.sessionsDir = tmpDir;
});
afterEach(() => {
  cfg.structureVariety = origVariety;
  cfg.sessionsDir = origSessions;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 결정적 난수(LCG) — 카운터형 가짜 rand 는 뽑는 순서에 따라 퇴화 시드를 만든다. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('pickStructureSeed — 시드 분포', () => {
  it('1000회 샘플에서 각 값이 모두 등장한다', () => {
    const seeds: StructureSeed[] = [];
    for (let i = 0; i < 1000; i++) seeds.push(pickStructureSeed(Math.random));
    for (const v of ['none', 'after-hook', 'mid', 'before-close']) {
      expect(seeds.some((s) => s.thesisQuote === v)).toBe(true);
    }
    for (const v of ['scene', 'question', 'claim', 'contrast', 'answer']) {
      expect(seeds.some((s) => s.openers === v)).toBe(true);
    }
    for (const v of ['twist', 'question', 'answer', 'variant', 'compare']) {
      expect(seeds.some((s) => s.titleForm === v)).toBe(true);
    }
    for (const v of ['sentence', 'numbered', 'question', 'keyword']) {
      expect(seeds.some((s) => s.headingStyle === v)).toBe(true);
    }
    for (const v of [3, 4, 5, 6]) expect(seeds.some((s) => s.headings === v)).toBe(true);
    expect(seeds.some((s) => s.quickAnswer === true)).toBe(true);
    expect(seeds.some((s) => s.quickAnswer === false)).toBe(true);
    for (const v of [2, 3, 4, 5]) expect(seeds.some((s) => s.cardLines === v)).toBe(true);
    for (const v of [10, 11, 12, 13, 14, 15]) expect(seeds.some((s) => s.hashtags === v)).toBe(true);
    for (const v of [4, 5, 6]) expect(seeds.some((s) => s.shortsScenes === v)).toBe(true);
  });

  it('값 범위를 벗어나지 않는다(rand 경계 0·1 포함)', () => {
    for (const r of [() => 0, () => 0.999999, () => 1]) {
      const s = pickStructureSeed(r);
      expect(['none', 'after-hook', 'mid', 'before-close']).toContain(s.thesisQuote);
      expect(['scene', 'question', 'claim', 'contrast', 'answer']).toContain(s.openers);
      expect(['twist', 'question', 'answer', 'variant', 'compare']).toContain(s.titleForm);
      expect(['sentence', 'numbered', 'question', 'keyword']).toContain(s.headingStyle);
      expect(s.headings).toBeGreaterThanOrEqual(3); // seo.ts 'H2 3개 이상' 하한
      expect(s.headings).toBeLessThanOrEqual(6);
      expect(s.cardLines).toBeGreaterThanOrEqual(2);
      expect(s.cardLines).toBeLessThanOrEqual(5);
      expect(s.hashtags).toBeGreaterThanOrEqual(10);
      expect(s.hashtags).toBeLessThanOrEqual(15);
      expect(s.shortsScenes).toBeGreaterThanOrEqual(4);
      expect(s.shortsScenes).toBeLessThanOrEqual(6);
    }
  });

  it('선택 블록(표·체크리스트·예고·빠른 답)은 항상 정확히 2개만 true — 넷 다 한 번씩은 켜지고 꺼진다', () => {
    const onCount = { table: 0, checklist: 0, teaser: 0, quickAnswer: 0 };
    const rand = lcg(20260827);
    for (let i = 0; i < 1000; i++) {
      const s = pickStructureSeed(rand);
      expect([s.table, s.checklist, s.teaser, s.quickAnswer].filter(Boolean).length).toBe(2);
      if (s.table) onCount.table++;
      if (s.checklist) onCount.checklist++;
      if (s.teaser) onCount.teaser++;
      if (s.quickAnswer) onCount.quickAnswer++;
    }
    // 어느 블록도 상시 on/상시 off 로 퇴화하지 않는다.
    for (const n of Object.values(onCount)) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(1000);
    }
  });

  // 같은 답을 두 번 하지 않게 — 도입이 답 먼저면 빠른 답 블록은 후보에서 빠진다.
  it('도입이 answer 인 런은 빠른 답 블록이 꺼진다(표·체크리스트·예고 중 2개)', () => {
    const rand = lcg(11);
    let answerRuns = 0;
    for (let i = 0; i < 1000; i++) {
      const s = pickStructureSeed(rand);
      if (s.openers !== 'answer') continue;
      answerRuns++;
      expect(s.quickAnswer).toBe(false);
      expect([s.table, s.checklist, s.teaser].filter(Boolean).length).toBe(2);
    }
    expect(answerRuns).toBeGreaterThan(0);
  });

  // 2026-10-02 — 통념 반박 도입(대비)이 매편 같은 글 인상의 대표 지문이었다. 몫을 종전 1/4 → 1/9 로 줄였다.
  it('대비(contrast) 도입 몫은 종전 1/4 보다 확실히 작다(목표 1/9)', () => {
    const rand = lcg(20261002);
    const N = 5000;
    let contrast = 0;
    for (let i = 0; i < N; i++) if (pickStructureSeed(rand).openers === 'contrast') contrast++;
    const share = contrast / N;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.16);
  });

  it('제목 형식·소제목 형식은 한 값으로 쏠리지 않는다(각 값 몫이 균등 근처)', () => {
    const rand = lcg(5);
    const N = 5000;
    const t: Record<string, number> = {};
    const h: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const s = pickStructureSeed(rand);
      t[s.titleForm!] = (t[s.titleForm!] ?? 0) + 1;
      h[s.headingStyle!] = (h[s.headingStyle!] ?? 0) + 1;
    }
    for (const n of Object.values(t)) expect(Math.abs(n / N - 1 / 5)).toBeLessThan(0.04);
    for (const n of Object.values(h)) expect(Math.abs(n / N - 1 / 4)).toBeLessThan(0.04);
    // 종전 단일 형식(관점형 제목)은 더 이상 기본값이 아니다 — 5편 중 1편 꼴.
    expect(t.twist! / N).toBeLessThan(0.25);
  });
});

describe('currentStructureSeed — 킬스위치', () => {
  it('STRUCTURE_VARIETY=off 면 고정 시드(after-hook·표+체크리스트·4줄·12개·5씬)', () => {
    cfg.structureVariety = false;
    const s = currentStructureSeed(lcg(1));
    expect(s).toEqual(FIXED_STRUCTURE_SEED);
    expect(s.openers).toBe('question');
    expect(s.thesisQuote).toBe('after-hook');
    expect(s.table).toBe(true);
    expect(s.checklist).toBe(true);
    expect(s.teaser).toBe(false);
    expect(s.cardLines).toBe(4);
    expect(s.hashtags).toBe(12);
    expect(s.shortsScenes).toBe(5);
  });

  // 2026-10-02 — 고정 시드는 structure.json 에 남아 리비전이 승계한다. 새 필드가 들어 있으면 다시 켠 뒤의 개정이 원 글에 없던
  // 제목 형식·소제목 형식·빠른 답을 "유지하라"고 지시하게 된다 — 키 집합이 HEAD(8개)와 같아야 한다.
  it('off 고정 시드에는 2026-10-02 추가 필드가 없다(키 집합이 종전 8개 그대로)', () => {
    cfg.structureVariety = false;
    const s = currentStructureSeed(lcg(1));
    expect(Object.keys(s).sort()).toEqual(['cardLines', 'checklist', 'hashtags', 'openers', 'shortsScenes', 'table', 'teaser', 'thesisQuote']);
    for (const k of ['titleForm', 'headingStyle', 'headings', 'quickAnswer'] as const) expect(k in s).toBe(false);
    // 다시 켠 뒤의 개정 블록도 그 줄들을 내지 않는다(구 기록과 같은 취급).
    const rev = structureBlock(s, { revise: true });
    expect(rev).not.toContain('소제목(## H2)');
    expect(rev).not.toContain('빠른 답');
  });

  it('on 이면 rand 로 뽑는다(고정 시드와 다른 조합이 나온다)', () => {
    const rand = lcg(7);
    const many = Array.from({ length: 200 }, () => currentStructureSeed(rand));
    expect(many.some((s) => JSON.stringify(s) !== JSON.stringify(FIXED_STRUCTURE_SEED))).toBe(true);
  });
});

describe('structureBlock — 작가 프롬프트 주입 문자열', () => {
  const seed: StructureSeed = {
    thesisQuote: 'mid', table: true, checklist: false, teaser: true,
    openers: 'contrast', cardLines: 3, hashtags: 11, shortsScenes: 6,
    titleForm: 'question', headingStyle: 'numbered', headings: 4, quickAnswer: false,
  };

  // 리뷰(2026-10-05) — 소제목 예시는 자리표시만(실제 주제 구절 "가을과 봄, 언제 심을까"는 모델이 그대로 베낀다).
  it('주제어 구 소제목 예시는 자리표시(○○·△△)로만', () => {
    const b = structureBlock({ ...seed, headingStyle: 'keyword' });
    expect(b).toContain('"○○와 △△, 언제 할까"');
    expect(b).not.toContain('가을과 봄, 언제 심을까');
    expect(b).not.toContain('지역별 월동 방법');
  });
  it('머리표와 다섯 항목(도입·중심 명제·표·체크리스트·예고)을 모두 담는다', () => {
    const b = structureBlock(seed);
    expect(b).toContain('[이번 글 구조]');
    expect(b).toContain('도입');
    expect(b).toContain('중심 명제');
    expect(b).toContain('표');
    expect(b).toContain('체크리스트');
    expect(b).toContain('예고');
  });

  it('도입 유형 5종을 각각 다른 문구로 지시한다', () => {
    const texts = (['scene', 'question', 'claim', 'contrast', 'answer'] as const)
      .map((o) => structureBlock({ ...seed, openers: o }));
    expect(new Set(texts).size).toBe(5);
    expect(structureBlock({ ...seed, openers: 'answer' })).toContain('첫 2~3문장 안에');
    expect(structureBlock({ ...seed, openers: 'scene' })).toContain('장면');
    expect(structureBlock({ ...seed, openers: 'question' })).toContain('질문');
    expect(structureBlock({ ...seed, openers: 'claim' })).toContain('단정');
    expect(structureBlock({ ...seed, openers: 'contrast' })).toContain('통념');
  });

  // 통념 반박 공식("~라고들 합니다. 그런데")은 대비 도입에서만 허용 — 나머지 넷은 명시적으로 금지한다.
  it('통념-반박 공식은 contrast 에서만 허용하고, 다른 도입 유형은 금지 문구를 단다', () => {
    const c = structureBlock({ ...seed, openers: 'contrast' });
    expect(c).toContain('이 유형에서만 허용');
    expect(c).not.toContain('통념-반박 공식으로 열지 마라');
    for (const o of ['scene', 'question', 'claim', 'answer'] as const) {
      const b = structureBlock({ ...seed, openers: o });
      expect(b).toContain('통념-반박 공식으로 열지 마라');
      expect(b).toContain('라고들 합니다');
    }
  });

  it('소제목 형식 4종·개수를 지시한다(번호형은 "N가지" 쪼개기가 아님을 못박는다)', () => {
    const by = (h: NonNullable<StructureSeed['headingStyle']>) => structureBlock({ ...seed, headingStyle: h, headings: 5 });
    expect(by('numbered')).toContain('"## 1. …"');
    expect(by('numbered')).toContain('"N가지" 쪼개기가 아니다');
    expect(by('question')).toContain('질문');
    expect(by('keyword')).toContain('하위 주제어');
    expect(by('sentence')).toContain('완결 서술문');
    expect(new Set((['sentence', 'numbered', 'question', 'keyword'] as const).map(by)).size).toBe(4);
    expect(by('keyword')).toContain('정확히 5개');
    expect(structureBlock({ ...seed, headings: 3 })).toContain('정확히 3개');
  });

  it('빠른 답 블록은 시드대로 켜고 끄며, 결론을 대신하지 못하게 한다', () => {
    const on = structureBlock({ ...seed, quickAnswer: true, table: false });
    expect(on).toContain('빠른 답: 넣는다');
    expect(on).toContain('결론을 대신하지 마라');
    expect(on).not.toContain('표가 켜져 있으니');
    expect(structureBlock({ ...seed, quickAnswer: true, table: true })).toContain('표가 켜져 있으니');
    expect(structureBlock({ ...seed, quickAnswer: false })).toContain('빠른 답: 넣지 마라');
  });

  // 2026-10-05 — 첫머리 굵은 요약 두 줄(편집 확정 규칙)이 한 줄 답을 맡는다. 빠른 답이 한 줄 답으로 나오면 맨 위에 같은 답이 두 번.
  it('빠른 답은 조건별로 갈리는 답만 — 한 줄 답·요약 반복 금지, 근거 없으면 생략', () => {
    const on = structureBlock({ ...seed, quickAnswer: true, table: false });
    expect(on).toContain('시기·지역·조건별로 갈리는 답');
    expect(on).toContain('한 줄짜리 답은 이 블록으로 쓰지 마라');
    expect(on).toContain('같은 답 두 번 금지');
    expect(on).toContain('근거 값이 없으면 이 블록은 생략한다');
    expect(on).not.toContain('(한 줄 답,');
  });
  it('답 먼저 도입은 첫머리 요약을 되풀이하지 않는다', () => {
    const b = structureBlock({ ...seed, openers: 'answer' });
    expect(b).toContain('요약 문장을 되풀이하지 말고');
    expect(structureBlock({ ...seed, openers: 'question' })).not.toContain('요약 문장을 되풀이하지 말고');
  });

  it('새 집필 블록은 페르소나의 도입부·소제목·예고 규칙보다 우선함을 밝힌다', () => {
    expect(structureBlock(seed)).toContain('이 블록이 우선한다');
  });

  // 제목은 작가가 아니라 포장 단계가 만든다 — 작가 블록에 제목 형식을 싣지 않는다(본문 각도를 제목 꼴에 끌려가게 하지 않게).
  it('작가 블록에는 제목 형식이 실리지 않는다(포장 단계 몫)', () => {
    const b = structureBlock({ ...seed, titleForm: 'compare' });
    expect(b).not.toContain('비교·종류형');
    expect(b).not.toContain('제목 형식');
  });

  it('구 기록(2026-10-02 이전, 새 필드 없음)의 개정 블록은 새 필드 줄을 내지 않는다 — undefined 도, 없던 골격도 없다', () => {
    const old: StructureSeed = {
      thesisQuote: 'none', table: false, checklist: true, teaser: true,
      openers: 'claim', cardLines: 2, hashtags: 15, shortsScenes: 4,
    };
    const r = structureBlock(old, { revise: true });
    expect(r).not.toContain('undefined');
    expect(r).not.toContain('소제목(## H2)');
    expect(r).not.toContain('빠른 답');
    expect(r).toContain('도입 유형');
    expect(r).toContain('예고');
  });

  it('중심 명제 인용 위치 4값을 구분해 쓴다', () => {
    expect(structureBlock({ ...seed, thesisQuote: 'none' })).toContain('쓰지 마라');
    expect(structureBlock({ ...seed, thesisQuote: 'after-hook' })).toContain('도입 훅 직후');
    expect(structureBlock({ ...seed, thesisQuote: 'mid' })).toContain('본문 중간');
    expect(structureBlock({ ...seed, thesisQuote: 'before-close' })).toContain('마무리 직전');
  });

  it('표·체크리스트는 시드에 따라 켜고 끈다', () => {
    const on = structureBlock({ ...seed, table: true, checklist: true, teaser: false });
    const off = structureBlock({ ...seed, table: false, checklist: false, teaser: true });
    expect(on).toContain('표: 넣는다');
    expect(on).toContain('체크리스트(">>> " 프레임): 넣는다');
    expect(off).toContain('표: 넣지 마라');
    expect(off).toContain('체크리스트(">>> " 프레임): 넣지 마라');
  });

  it('예고는 켜져도 "결론을 예고로 미루기"를 허용하지 않는다(결론 의무 자산 보존)', () => {
    const on = structureBlock({ ...seed, teaser: true });
    expect(on).toContain('마무리를 완결한 뒤');
    expect(on).toContain('한 줄');
    expect(structureBlock({ ...seed, teaser: false })).toContain('예고: 넣지 마라');
  });

  it('리비전 모드는 골격을 "유지하라"로 말한다(재구성 유도 금지)', () => {
    const w = structureBlock(seed);
    const r = structureBlock(seed, { revise: true });
    expect(r).toContain('유지');
    expect(r).not.toBe(w);
  });
});

describe('resolveStructureSeed / inheritStructureSeed — sessions/<runId>/structure.json 저장·재사용', () => {
  it('새 런은 시드를 뽑아 structure.json 에 남긴다', () => {
    const s = resolveStructureSeed('run-A');
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'run-A', 'structure.json'), 'utf-8')) as StructureSeed;
    expect(saved).toEqual(s);
  });

  // 2026-10-02 — 형식별 성과 비교의 키가 되려면 새 필드가 기록·승계 양쪽에서 살아 있어야 한다.
  it('새 필드(제목 형식·소제목 형식·개수·빠른 답)도 기록되고 리비전이 그대로 승계한다', () => {
    const s = resolveStructureSeed('run-H');
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'run-H', 'structure.json'), 'utf-8')) as StructureSeed;
    for (const k of ['titleForm', 'headingStyle', 'headings', 'quickAnswer'] as const) {
      expect(saved[k]).toBeDefined();
      expect(saved[k]).toEqual(s[k]);
    }
    const rev = inheritStructureSeed('run-H-rev', 'run-H');
    expect(rev).toEqual(s);
  });

  it('구 기록(새 필드 없음)도 승계는 그대로 된다(새 필드는 undefined 로 남고 지어 넣지 않는다)', () => {
    fs.mkdirSync(path.join(tmpDir, 'run-I'), { recursive: true });
    const old = {
      thesisQuote: 'mid', table: true, checklist: true, teaser: false,
      openers: 'scene', cardLines: 3, hashtags: 12, shortsScenes: 5,
    };
    fs.writeFileSync(path.join(tmpDir, 'run-I', 'structure.json'), JSON.stringify(old), 'utf-8');
    const rev = inheritStructureSeed('run-I-rev', 'run-I');
    expect(rev).toEqual(old);
    expect(rev?.titleForm).toBeUndefined();
  });

  it('리비전 런(baseRunId)은 원 런과 같은 시드를 승계하고 자기 런에도 남긴다(연쇄 리비전)', () => {
    const base = resolveStructureSeed('run-B');
    const rev = inheritStructureSeed('run-B-rev', 'run-B');
    expect(rev).toEqual(base);
    const chained = JSON.parse(fs.readFileSync(path.join(tmpDir, 'run-B-rev', 'structure.json'), 'utf-8')) as StructureSeed;
    expect(chained).toEqual(base);
  });

  // 승계는 '같은 시드'다 — 없는 골격을 새로 뽑아 "유지하라"고 말하면 그건 재구성 지시가 된다.
  it('원 런에 structure.json 이 없으면(이 기능 이전 런) null — 새로 뽑지도, 파일을 만들지도 않는다', () => {
    expect(inheritStructureSeed('run-C-rev', 'run-없음')).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'run-C-rev', 'structure.json'))).toBe(false);
  });

  it('baseRunId 자체가 없어도 null(초안을 만든 런을 모르는 리비전)', () => {
    expect(inheritStructureSeed('run-F-rev')).toBeNull();
  });

  // Fix round(finding 2) — 킬스위치는 시드를 '뽑는' 동작만 지배한다. 기록된 시드를 고정 시드로 갈아치우면
  // 다양화 시드로 쓰인 초안의 리비전이 "표·프레임을 유지하라"는 지시를 받아 없던 구조를 새로 만든다.
  it('off 여도 기록된 시드를 그대로 승계한다(고정 시드로 갈아치우지 않는다)', () => {
    fs.mkdirSync(path.join(tmpDir, 'run-D'), { recursive: true });
    const varied: StructureSeed = {
      thesisQuote: 'none', table: false, checklist: true, teaser: true,
      openers: 'claim', cardLines: 2, hashtags: 15, shortsScenes: 4,
    };
    fs.writeFileSync(path.join(tmpDir, 'run-D', 'structure.json'), JSON.stringify(varied), 'utf-8');
    cfg.structureVariety = false;
    expect(inheritStructureSeed('run-D-rev', 'run-D')).toEqual(varied);
    // 연쇄 리비전도 같은 골격을 물려받는다 — off 경로의 종전 구현은 이 파일을 아예 남기지 않았다.
    const chained = JSON.parse(fs.readFileSync(path.join(tmpDir, 'run-D-rev', 'structure.json'), 'utf-8')) as StructureSeed;
    expect(chained).toEqual(varied);
  });

  it('off 이고 물려받을 기록도 없으면 null(호출부가 유지 블록을 쓴다)', () => {
    cfg.structureVariety = false;
    expect(inheritStructureSeed('run-G-rev', 'run-없음')).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'run-G-rev', 'structure.json'))).toBe(false);
  });

  it('손상된 structure.json 은 승계하지 않는다(null)', () => {
    fs.mkdirSync(path.join(tmpDir, 'run-E'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'run-E', 'structure.json'), '{"thesisQuote":', 'utf-8');
    expect(inheritStructureSeed('run-E-rev', 'run-E')).toBeNull();
  });
});

// BLOG_BODY_GUIDE 가 인용구·프레임·표를 [이번 글 구조] 에 위임하므로, 시드를 모르는 자리(승계 실패 리비전·
// 지적만 고치는 수정 라운드)에도 블록이 있어야 한다 — 없으면 작가가 "안 켜졌다"로 읽고 걷어낸다.
describe('STRUCTURE_KEEP_BLOCK — 시드를 모르는 자리의 유지 블록', () => {
  it('같은 머리표를 쓰고, 인용구·프레임·표를 그대로 두라고 말한다', () => {
    expect(STRUCTURE_KEEP_BLOCK.startsWith('[이번 글 구조]')).toBe(true);
    expect(STRUCTURE_KEEP_BLOCK).toContain('그대로 유지');
    expect(STRUCTURE_KEEP_BLOCK).toContain('>>');
    expect(STRUCTURE_KEEP_BLOCK).toContain('표');
    expect(STRUCTURE_KEEP_BLOCK).toContain('새로 넣거나 빼지 마라');
  });
});

// 제목 형식 문구(2026-10-02) — 포장 단계가 제목 후보 1순위에 건다. 다섯 형식이 서로 다른 지시여야 하고,
// 사실을 지어낼 수 있는 실제 수치·수종 예시를 담으면 안 된다(예시 구절 복사 사고 — ○○ 자리표시만).
describe('TITLE_FORM_TEXT — 제목 형식 지시', () => {
  it('다섯 형식이 모두 다르고 각자의 꼴을 말한다', () => {
    const v = Object.values(TITLE_FORM_TEXT);
    expect(v.length).toBe(5);
    expect(new Set(v).size).toBe(5);
    expect(TITLE_FORM_TEXT.question).toContain('물음표');
    expect(TITLE_FORM_TEXT.answer).toContain('구체적인 답');
    expect(TITLE_FORM_TEXT.variant).toContain('하위 주제어 하나');
    expect(TITLE_FORM_TEXT.variant).toContain('나열하지 말고');
    expect(TITLE_FORM_TEXT.compare).toContain('비교가 없으면');
  });
  it('예시는 ○○ 자리표시만 쓴다(실제 수치 예시 없음)', () => {
    for (const t of Object.values(TITLE_FORM_TEXT)) {
      expect(t).toContain('○○');
      expect(t).not.toMatch(/\d+월/);
    }
  });
});

// 2026-10-05 — 첫머리 굵은 요약(편집 확정 규칙)이 켜진 런은 '답 먼저' 도입·도입 직후 인용을 뽑지 않는다(같은 답이 첫머리에 쌓였다).
describe('pickStructureSeed — 굵은 요약 런의 첫머리 겹침 방지(2026-10-05)', () => {
  it('boldSummary 면 answer 도입·after-hook 인용이 나오지 않는다', () => {
    const rand = lcg(7);
    const seeds = Array.from({ length: 2000 }, () => pickStructureSeed(rand, { boldSummary: true }));
    expect(seeds.some((s) => s.openers === 'answer')).toBe(false);
    expect(seeds.some((s) => s.thesisQuote === 'after-hook')).toBe(false);
    for (const v of ['scene', 'question', 'claim', 'contrast']) expect(seeds.some((s) => s.openers === v), v).toBe(true);
    for (const v of ['none', 'mid', 'before-close']) expect(seeds.some((s) => s.thesisQuote === v), v).toBe(true);
    expect(seeds.every((s) => [s.table, s.checklist, s.teaser, s.quickAnswer].filter(Boolean).length === 2)).toBe(true);
  });
  it('끈 런(옵션 없음)은 종전 시드와 같다 — rand 소비 순서 불변', () => {
    const a = lcg(42); const b = lcg(42);
    for (let i = 0; i < 50; i++) expect(pickStructureSeed(a, {})).toEqual(pickStructureSeed(b));
  });
  it('질문형 소제목은 "~할까요?/~나요?" 꼴, 어느 형식이든 키워드 1곳·수종명 2곳', () => {
    const s = { ...FIXED_STRUCTURE_SEED, headingStyle: 'question' as const, headings: 4 as const };
    const block = structureBlock(s);
    expect(block).toContain('"~할까요?/~나요?/~인가요?"');
    expect(block).toContain('"~습니까?" 금지');
    expect(block).toContain('핵심 키워드는 소제목 1곳까지, 수종 이름은 2곳까지');
    expect(structureBlock({ ...s, headingStyle: 'keyword' })).toContain('수종 이름은 소제목 2곳까지');
  });
});
