import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  authorPreset, batchSpecies, builtinPresets, checkPreset, episodeSpeciesNames, extractRefs, loadSpeciesIndex, prepareSpecies, presetId, refPlan,
  schemaText, speciesModuleSource, speciesSnippets,
} from './speciesPreset';
import type { LlmJSON } from './writer';
import type { MediaItem } from './footage';

const REPO = path.resolve('.');
const kitJson = (name: string) => JSON.parse(fs.readFileSync(path.join(REPO, 'remotion/longform/fullscreen/species', `${name}.json`), 'utf8'));
const apple = () => ({
  ...kitJson('persimmon'), id: 'apple', nameKo: '사과나무', latin: 'Malus pumila',
  leaf: { ...kitJson('persimmon').leaf, margin: 'serrate' },
  flower: { ...kitJson('persimmon').flower, petals: 5, shape: 'open', calyx: 'small', stamens: 'many', inflorescence: 'corymb', months: [4, 5] },
  fruit: { type: 'pome', ratio: 0.9, sizeCm: [6, 9], bearing: 'single', months: [9, 10] },
});

describe('종 프리셋 검사', () => {
  it('키트 내장 JSON(감나무·블루베리·일반형)은 엄격 검사를 통과한다 — schema.ts 열거값과 어긋나면 여기서 걸린다', () => {
    for (const n of ['persimmon', 'blueberry', 'generic']) expect(checkPreset(kitJson(n)), n).toEqual([]);
    expect(builtinPresets(REPO).map((b) => b.id).sort()).toEqual(['blueberry', 'persimmon']);
  });
  it('열거값 밖·범위 밖·월 오류를 잡는다(키트 checkSpeciesProfile 이 놓치는 것)', () => {
    const bad = { ...apple(), leaf: { ...apple().leaf, shape: 'oblong' }, habit: { ...apple().habit, branchAngle: 140 }, fruit: { ...apple().fruit, months: [13] } };
    const p = checkPreset(bad).join(' / ');
    expect(p).toContain("leaf.shape='oblong'");
    expect(p).toContain('habit.branchAngle=140');
    expect(p).toContain('fruit.months');
    expect(checkPreset(apple())).toEqual([]);
  });
  it('presetId — 영문 소문자, 내장·쓴 id·generic 과 겹치면 숫자', () => {
    expect(presetId('Apple Tree', new Set())).toBe('appletree');
    expect(presetId('persimmon', new Set(['persimmon']))).toBe('persimmon2');
    expect(presetId('사과', new Set())).toBe('sp');
    expect(presetId('generic', new Set())).toBe('generic2');
  });
  it('schemaText 는 schema.ts 타입 부분(검사 함수 앞)', () => {
    const t = schemaText(REPO);
    expect(t).toContain('export type LeafShape');
    expect(t).not.toContain('const isNum');
  });
});

describe('편 수종·원문', () => {
  const script = {
    heroSpecies: '감나무', species: ['감나무', '사과나무', '대추나무'],
    chapters: [
      { id: 'intro', title: 't', species: [], segments: [{ id: 'intro-01', narration: '사과나무와 감나무는 다릅니다.' }] },
      { id: 'gam', title: 't', species: ['감나무'], segments: [{ id: 'gam-01', narration: '감나무 이야기.' }] },
    ],
  };
  it('주인공 → 장 수종 → 낭독에 나오는 편 수종(대추나무는 낭독에 없어 뺀다)', () => {
    expect(episodeSpeciesNames(script)).toEqual(['감나무', '사과나무']);
  });
  it('speciesSnippets — 그 수종 이름이 든 문장만', () => {
    expect(speciesSnippets('사과나무 잎은 톱니가 있다. 감나무는 다르다.\n사과 꽃은 흰색이다.', '사과나무')).toBe('사과나무 잎은 톱니가 있다.\n사과 꽃은 흰색이다.');
  });
});

describe('서다인 프리셋 작성', () => {
  it('첫 답이 검사에 떨어지면 문제를 알려 주고 한 번 더 — 통과분에 id·이름·출처를 붙인다', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ id: 'apple', profile: { ...apple(), leaf: { ...apple().leaf, shape: 'oblong' } } })
      .mockResolvedValueOnce({ id: 'apple', profile: apple(), confidence: { habit: 'high', leaf: 'high', flower: 'medium' }, basis: ['국가생물종지식정보시스템 사과나무'] });
    const r = await authorPreset({ nameKo: '사과나무', sourceText: '', llm: llm as unknown as LlmJSON, model: 'm', schemaText: 'S', example: 'E', taken: new Set(['persimmon']), date: '2026-10-23' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(llm).toHaveBeenCalledTimes(2);
    expect(String(llm.mock.calls[1]![2])).toContain("leaf.shape='oblong'");
    expect(r.id).toBe('apple');
    expect(r.confidence).toEqual({ habit: 'high', leaf: 'high', flower: 'medium', fruit: 'low' });
    expect((r.profile.sources as string[]).join()).toContain('신뢰 낮음: fruit');
  });
  it('두 번 다 떨어지면 실패(문제 목록)', async () => {
    const llm = vi.fn(async () => ({ profile: { id: 'x' } })) as unknown as LlmJSON;
    const r = await authorPreset({ nameKo: '사과나무', sourceText: '', llm, model: 'm', schemaText: '', example: '', taken: new Set(), date: 'd' });
    expect(r.ok).toBe(false);
  });
});

describe('실물 대조용 사진', () => {
  it('refPlan — 긴 영상 3개까지, 파일 수에 따라 2~4장, 6장 상한', () => {
    expect(refPlan([{ file: 'a', seconds: 10 }])).toHaveLength(4);
    expect(refPlan([{ file: 'a', seconds: 10 }, { file: 'b', seconds: 10 }])).toHaveLength(6);
    expect(refPlan([{ file: 'a', seconds: 10 }, { file: 'b', seconds: 10 }, { file: 'c', seconds: 10 }, { file: 'd', seconds: 10 }]).map((p) => p.file)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
  });
  it('extractRefs — 그 수종(…나무 표기 차이 무시) 영상에서만, refs/<수종>/NN.jpg', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-refs-'));
    const media: MediaItem[] = [
      { id: 'm1', file: '/v/blue1.mp4', kind: 'video', seconds: 20, species: '블루베리나무' },
      { id: 'm2', file: '/v/apple.mp4', kind: 'video', seconds: 30, species: '사과나무' },
    ];
    const ffmpeg = vi.fn(async (args: string[]) => { fs.writeFileSync(args[args.length - 1]!, 'jpg'); });
    const refs = await extractRefs({ dir, nameKo: '블루베리', media, ffmpeg });
    expect(refs).toEqual(['refs/블루베리/01.jpg', 'refs/블루베리/02.jpg', 'refs/블루베리/03.jpg', 'refs/블루베리/04.jpg']);
    expect(ffmpeg.mock.calls.every((c) => c[0].includes('/v/blue1.mp4'))).toBe(true);
    expect(await extractRefs({ dir, nameKo: '대추나무', media, ffmpeg })).toEqual([]);
  });
});

describe('prepareSpecies — 수종 형태 단계', () => {
  it('내장 프리셋은 그대로, 없는 수종은 서다인 작성(검사 통과분만 _species.ts 에), 실패하면 일반형 — index.json 기록', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-species-'));
    const script = {
      heroSpecies: '감나무', species: ['사과나무', '대추나무'],
      chapters: [{ id: 'a', title: 't', species: ['사과나무'], segments: [{ id: 'a-01', narration: '대추나무와 사과나무, 감나무.' }] }],
    };
    const llm = vi.fn(async (_m: string, _s: string, user: string) => (user.includes('[수종] 사과나무') ? { id: 'apple', profile: apple(), confidence: { habit: 'high', leaf: 'high', flower: 'high', fruit: 'high' } } : { profile: { id: 'jujube' } })) as unknown as LlmJSON;
    const media: MediaItem[] = [{ id: 'g', file: '/v/gam.mp4', kind: 'video', seconds: 12, species: '감나무' }];
    const ffmpeg = async (args: string[]) => { fs.writeFileSync(args[args.length - 1]!, 'jpg'); };
    const ix = await prepareSpecies({ dir, script, media, sourceText: '', repo: REPO, llm, model: 'm', ffmpeg, now: () => new Date('2026-10-23T00:00:00Z') });
    expect(ix.hero).toBe('감나무');
    expect(ix.species.map((e) => [e.nameKo, e.source, e.use])).toEqual([
      ['감나무', 'builtin', 'species="persimmon"'],
      ['사과나무', 'episode', 'species={EP_SPECIES.apple}'],
      ['대추나무', 'generic', 'species="generic"'],
    ]);
    expect(ix.species[0]!.refs).toHaveLength(4);
    expect(ix.species[2]!.why).toContain('프리셋 작성 실패');
    expect(fs.existsSync(path.join(dir, 'species', 'apple.json'))).toBe(true);
    const mod = fs.readFileSync(path.join(dir, 'scenes', '_species.ts'), 'utf8');
    expect(mod).toContain('export const EP_SPECIES = {');
    expect(mod).toContain('  apple: {"id":"apple"');
    expect(mod).toContain('} satisfies Record<string, SpeciesProfile>;');
    expect(mod).toMatch(/import type \{ SpeciesProfile \} from '(\.\.\/)+.*remotion\/longform\/fullscreen\/species\/schema';/);
    expect(loadSpeciesIndex(dir)?.species).toHaveLength(3);
    // 묶음 표 — 그 묶음 수종만, 주의 문구
    const b = batchSpecies(ix, ['사과나무', '대추나무']);
    expect(b.map((x) => x.nameKo)).toEqual(['사과나무', '대추나무']);
    expect(b[1]!.note).toContain('일반형');
    expect(batchSpecies(null, ['감나무'])).toEqual([]);
  });
  it('speciesModuleSource — 프리셋이 없으면 빈 EP_SPECIES', () => {
    expect(speciesModuleSource('/r/data/ep/scenes', '/r', [])).toContain('export const EP_SPECIES = {} satisfies Record<string, SpeciesProfile>;');
  });
});
