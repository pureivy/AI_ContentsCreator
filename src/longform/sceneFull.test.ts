import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fullLintOpts, fullSpecs, insetSpecies, lookScore, pickInsetKeys, planInsets, scenePromptFull } from './sceneFull';
import { footageOf, toFullProps } from './fullProps';
import { lintScene } from './sceneLint';
import { kitShimSourceFull, registrySourceFull } from './sceneFiles';
import { sceneSpecs } from './sceneJob';
import type { TimedSegment, Timeline } from './timeline';

const seg = (id: string, chapter: string, narration: string, o: Partial<TimedSegment> = {}): TimedSegment => ({
  id, chapter: chapter as TimedSegment['chapter'], chapterTitle: chapter, narration, audio: `${id}.mp3`, startFrame: 0, frames: 120,
  captions: [{ text: narration, startFrame: 0, endFrame: 120 }], shot: { segId: id, cardOnly: true } as TimedSegment['shot'], ...o,
});
const withClip = (s: TimedSegment, mediaId: string): TimedSegment => ({ ...s, clip: `${s.id}.mp4`, shot: { segId: s.id, mediaId, file: '/x.mp4', startSec: 0.5, seconds: 4 } as TimedSegment['shot'] });
const species = (id: string) => ({ m_persimmon: '감나무', m_apple: '사과나무' } as Record<string, string>)[id];

describe('전체 화면 — 실촬영 지정 장면', () => {
  it('lookScore: 보이는 것(크기·굵기·잎)·수종 지정에 점수, 땅속 이야기는 낮다', () => {
    expect(lookScore('감나무는 낙엽수로, 다 자라면 6~14m까지 올라갑니다.', ['감나무'])).toBeGreaterThan(lookScore('뿌리가 넓게 퍼져 물을 끌어옵니다.'));
  });
  it('pickInsetKeys: 장마다 실촬영 있는 세그먼트 중 점수 최고 하나, 실촬영 없는 장은 없음', () => {
    const picks = pickInsetKeys([
      { key: 's000', chapterIndex: 0, narration: '잎이 다 진 뒤', hasFootage: false },
      { key: 's001', chapterIndex: 1, narration: '어린 나무는 밑천이 적습니다.', hasFootage: true },
      { key: 's002', chapterIndex: 1, narration: '다 자라면 6~14m까지 올라갑니다.', hasFootage: true, hint: ['감나무'] },
    ]);
    expect([...picks]).toEqual(['s002']);
  });
  it('footageOf: 그 장 수종 영상만(다른 수종 화면은 끼우지 않는다)', () => {
    expect(footageOf(withClip(seg('a', 'c1', '문장'), 'm_persimmon'), ['감나무'], species)).toEqual({ src: 'a.mp4', startFrom: 0, durationInFrames: 120 });
    expect(footageOf(withClip(seg('a', 'c1', '문장'), 'm_apple'), ['감나무'], species)).toBeUndefined();
    expect(footageOf(withClip(seg('a', 'c1', '문장'), 'm_persimmon'), [], species)).toBeUndefined();
  });
  it('fullSpecs: 실촬영·지정·자막·장 수를 붙이고, 수종이 다른 장면은 실촬영 없음', () => {
    const segs = [withClip(seg('i1', 'intro', '고민하는 때예요.'), 'm_apple'), withClip(seg('h1', 'hard', '어린 나무'), 'm_persimmon'), withClip(seg('h2', 'hard', '다 자라면 6~14m', { footageHint: ['감나무'] }), 'm_persimmon')];
    const ch = { intro: [], hard: ['감나무'] };
    const specs = fullSpecs(sceneSpecs(segs, ch, species), segs, ch, species, 8);
    expect(specs.map((s) => [s.key, !!s.full?.footage, s.full?.insetRequired])).toEqual([['s000', false, false], ['s001', true, false], ['s002', true, true]]);
    expect(specs[2]!.full!.chapterTotal).toBe(8);
    expect(fullLintOpts(specs[0]!)).toMatchObject({ stage: 'FullStage', noFootage: true, insetRequired: false, noHands: true });
  });
});

describe('전체 화면 — 주인공 수종 끼움 카드(2026-10-23 사장님 결정)', () => {
  const sc = (hero?: string) => ({ ...(hero ? { heroSpecies: hero } : {}), species: ['감나무', '사과나무'], chapters: [
    { id: 'intro', title: 't', species: [], segments: [{ id: 'intro-01', narration: '' }] },
    { id: 'hard', title: 't', species: ['감나무'], segments: [{ id: 'hard-01', narration: '' }, { id: 'hard-02', narration: '' }] },
  ] });
  it('insetSpecies: 수종 장은 그 수종, 수종 없는 장은 주인공만(편 수종 전체가 아니다), 주인공 없으면 장 수종 최다', () => {
    expect(insetSpecies(sc('감나무'))).toEqual({ intro: ['감나무'], hard: ['감나무'] });
    expect(insetSpecies(sc())).toEqual({ intro: ['감나무'], hard: ['감나무'] });
    expect(insetSpecies({ chapters: [{ id: 'x', title: 't', species: [], segments: [] }] })).toEqual({ x: [] });
  });
  it('planInsets: 다른 수종 영상은 끼우지 않고, 쓸 클립이 없는 장은 같은 수종 클립을 빌려 모습을 말하는 문장 하나에 준다', () => {
    const segs = [
      withClip(seg('i1', 'intro', '고민하는 때예요.'), 'm_apple'),
      seg('i2', 'intro', '다 자라면 잎이 넓고 열매가 큽니다.'),
      withClip(seg('h1', 'hard', '어린 나무', { frames: 90 }), 'm_persimmon'),
      withClip(seg('h2', 'hard', '감나무 줄기', { frames: 150 }), 'm_persimmon'),
    ];
    const p = planInsets(segs, { intro: ['감나무'], hard: ['감나무'] }, species);
    expect(p.footage.has('i1')).toBe(false); // 사과나무 영상 — 감나무 편 도입에 끼우지 않는다
    expect(p.footage.get('i2')).toEqual({ src: 'h2.mp4', startFrom: 0, durationInFrames: 120, species: '감나무', borrowed: 'h2' });
    expect(p.footage.get('h1')?.borrowed).toBeUndefined();
    expect(p.missing).toEqual([]);
    const none = planInsets(segs.slice(0, 2), { intro: ['배나무'] }, species);
    expect(none.footage.size).toBe(0);
    expect(none.missing).toEqual([{ chapter: 'intro', why: '배나무 실촬영 없음' }]);
    // fullSpecs 가 같은 배정으로 지정 장면을 고른다 — 도입 장에도 하나
    const ch = { intro: ['감나무'], hard: ['감나무'] };
    const specs = fullSpecs(sceneSpecs(segs, { intro: [], hard: ['감나무'] }, species), segs, ch, species, 2);
    expect(specs.filter((s) => s.full?.insetRequired).map((s) => s.segId)).toEqual(['i2', 'h2']);
  });
  it('scenePromptFull: 묶음 수종 표(프리셋 쓰는 법·실물 대조용 사진)', () => {
    const segs = [seg('i1', 'intro', '문장')];
    const specs = fullSpecs(sceneSpecs(segs, {}, species), segs, {}, species, 1);
    const p = scenePromptFull({ scenes: specs, style: 'B', species: [{ nameKo: '사과나무', use: 'species={EP_SPECIES.apple}', note: '이 편 전용', refs: ['refs/사과나무/01.jpg'] }] }, 'KIT');
    expect(p).toContain('- 사과나무: species={EP_SPECIES.apple} — 이 편 전용');
    expect(p).toContain('실물 대조용 사진 — 우리 실촬영: refs/사과나무/01.jpg');
    expect(p).not.toContain('공개 도감 사진');
    expect(scenePromptFull({ scenes: specs, style: 'B' }, 'KIT')).not.toContain('이 묶음 수종');
    // 공개 도감 사진(출처 기록됨) — 부위 이름과 함께, 내부 참고라는 주의
    const p2 = scenePromptFull({ scenes: specs, style: 'B', species: [{ nameKo: '감나무', use: 'species="persimmon"', refs: [], ext: [{ part: 'bark', file: 'refs/감나무/commons-bark-1.jpg' }] }] }, 'KIT');
    expect(p2).toContain('실물 대조용 사진 — 우리 실촬영: 없음 / 공개 도감 사진(출처 기록됨): 수피(성목 껍질) refs/감나무/commons-bark-1.jpg');
    expect(p2).toContain('사진을 장면에 넣거나 따라 베끼지 않는다');
  });
});

describe('전체 화면 — 검사 옵션', () => {
  const sent = '다 자란 감나무는 뿌리가 넓고 몸통에 양분이 많지만, 어린 묘목은 뿌리도 양분도 적어 첫 겨울 언 땅에 약합니다.';
  const example = fs.readFileSync(path.resolve('remotion/longform/fullscreen/styleA/examples/E2.tsx'), 'utf8').replace(/seed="e2/g, 'seed="s012-');
  it('키트 예시 장면은 전체 화면 옵션으로 통과한다', () => {
    expect(lintScene(example, 's012', sent, { stage: 'FullStage', urlPrefixes: ['a-', 'b-'], noRawText: true })).toEqual([]);
  });
  it('종전 기본값(SceneStage)이면 무대 없음으로 걸린다 — 기본값은 그대로', () => {
    expect(lintScene(example, 's012', sent)).toContain('SceneStage 무대를 쓰지 않음');
  });
  it('<text> 직접·지정 장면인데 카드 없음·실촬영 없는데 카드', () => {
    const raw = example.replace('</FullStage>', '<text x={1} y={2}>{L1}</text></FullStage>');
    expect(lintScene(raw, 's012', sent, { stage: 'FullStage', noRawText: true }).join()).toContain('<text> 직접 쓰기 금지');
    expect(lintScene(example, 's012', sent, { stage: 'FullStage', insetRequired: true }).join()).toContain('실촬영 지정 장면');
    const withInset = example.replace('</FullStage>', '<FootageInset footage={undefined} x={1} y={2} at={0} /></FullStage>');
    expect(lintScene(withInset, 's012', sent, { stage: 'FullStage', noFootage: true }).join()).toContain('실촬영이 없다');
  });
  it('url(#a-…) 공용 접두사는 전체 화면 옵션에서만 허용', () => {
    const src = example.replace('</FullStage>', '<path d="M0 0" fill="url(#a-h45)" /></FullStage>');
    expect(lintScene(src, 's012', sent, { stage: 'FullStage', urlPrefixes: ['a-', 'b-'] })).toEqual([]);
    expect(lintScene(src, 's012', sent, { stage: 'FullStage' }).join()).toContain('url(#a-h45)');
  });
});

describe('전체 화면 — 생성 파일·props', () => {
  it('_kit.ts 는 스타일 키트·무대·모양을 다시 내보낸다', () => {
    const src = kitShimSourceFull('/r/data/longform/x/scenes', '/r', 'B');
    expect(src).toContain("export * from '../../../../remotion/longform/fullscreen/styleB/kit';");
    expect(src).toContain('FootageInset');
    expect(registrySourceFull(['s001'])).toContain('FullSceneProps as SceneProps');
    expect(src).not.toContain('EP_SPECIES');
    expect(kitShimSourceFull('/r/data/longform/x/scenes/work/b01', '/r', 'B', '/r/data/longform/x/scenes/_species.ts')).toContain("export { EP_SPECIES } from '../../_species';");
  });
  it('toFullProps: 장 번호·실촬영·장면 단어 시각', () => {
    const tl: Timeline = { segments: [{ ...seg('h1', 'hard', '어린 나무는 밑천이 적습니다.'), startFrame: 75, scene: 's000' }], chapterStarts: [{ id: 'hard' as TimedSegment['chapter'], title: '장', startFrame: 0, frames: 75 }], totalFrames: 195 };
    const p = toFullProps('편', tl, { style: 'B', chapterTotal: 8, footage: new Map([['h1', { src: 'h1.mp4', startFrom: 0, durationInFrames: 120 }]]) });
    expect(p.chapterTotal).toBe(8);
    expect(p.segments[0]).toMatchObject({ chapterIndex: 0, scene: 's000', footage: { src: 'h1.mp4' } });
    expect(p.segments[0]!.sceneWords?.length).toBe(4);
  });
});
