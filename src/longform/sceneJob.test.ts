import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planBatches, scenePrompt, sceneSpecs } from './sceneJob';
import { entrySources, importPath, kitShimSource, registrySource, sceneKey } from './sceneFiles';
import type { TimedSegment } from './timeline';

const seg = (id: string, chapter: string, narration: string, media = true): TimedSegment => ({
  id, chapter, chapterTitle: `${chapter} 장`, narration, audio: `${id}.mp3`, startFrame: 0, frames: 150, captions: [],
  shot: media ? { segId: id, mediaId: 'm1', file: '/m.mp4', startSec: 0, seconds: 5 } : { segId: id, cardOnly: true },
});

describe('sceneSpecs·planBatches', () => {
  const segs = [
    ...Array.from({ length: 9 }, (_, i) => seg(`a-${i}`, 'a', `가 문장 ${i}`)),
    ...Array.from({ length: 3 }, (_, i) => seg(`b-${i}`, 'b', `나 문장 ${i}`, i !== 1)),
  ];
  const specs = sceneSpecs(segs, { a: ['블루베리'] }, (id) => (id === 'm1' ? '블루베리' : undefined));
  it('키는 편 전체 번호 3자리, 앞뒤 문장은 같은 장 안에서만, 단어 시각은 쉼을 뺀 구간에', () => {
    expect(specs.map((s) => s.key).slice(0, 3)).toEqual(['s000', 's001', 's002']);
    expect(specs[9]).toMatchObject({ key: 's009', chapterIndex: 1, species: [] });
    expect(specs[8]!.next).toBeUndefined();
    expect(specs[9]!.prev).toBeUndefined();
    expect(specs[1]).toMatchObject({ prev: '가 문장 0', next: '가 문장 2', species: ['블루베리'], footage: '블루베리 실촬영 영상', file: 's001.tsx' });
    expect(specs[10]!.footage).toBe('같은 장 실촬영의 정지 화면');
    expect(specs[0]!.words.at(-1)!.start).toBeLessThan(150 / 30 - 0.35);
  });
  it('장 경계를 넘지 않고 최대 8개, 길면 고르게(9 = 5+4)', () => {
    expect(planBatches(specs).map((b) => b.map((s) => s.key))).toEqual([
      ['s000', 's001', 's002', 's003', 's004'], ['s005', 's006', 's007', 's008'], ['s009', 's010', 's011'],
    ]);
    expect(planBatches(specs, 3).map((b) => b.length)).toEqual([3, 3, 3, 3]);
  });
  it('지시문 — 장면·문장·규칙·키트 문서 전문', () => {
    const p = scenePrompt({ scenes: specs.slice(0, 2) }, '# 장면 키트 API 본문', { episodeTitle: '블루베리 화분' });
    expect(p).toContain('s000 → 파일 s000.tsx');
    expect(p).toContain('문장: 가 문장 1');
    expect(p).toContain('./check.sh sNNN');
    expect(p).toContain('./preview.sh sNNN');
    expect(p).toContain("`./_kit`");
    expect(p).toContain('s007-glow');
    expect(p.endsWith('# 장면 키트 API 본문')).toBe(true);
  });
});

describe('sceneFiles — 생성 파일', () => {
  const repo = '/r';
  it('import 경로는 path.relative(데이터 폴더가 옮겨도 맞게)', () => {
    expect(importPath('/r/data/longform/ep/scenes', '/r/remotion/longform/illus/Kit2.tsx')).toBe('../../../../remotion/longform/illus/Kit2');
    expect(importPath('/r/a', '/r/a/b.ts')).toBe('./b');
    expect(kitShimSource('/r/data/longform/ep/scenes/work/b01', repo)).toContain("export * from '../../../../../../remotion/longform/illus/Kit2';");
    expect(sceneKey(7)).toBe('s007');
  });
  it('등록표는 정적 import 만, 키가 아니면 거절', () => {
    const r = registrySource(['s000', 's012']);
    expect(r).toContain("import s000 from './s000';");
    expect(r).toContain('= { s000, s012 };');
    expect(() => registrySource(['../x'])).toThrow();
  });
  it('진입점 — makeLongFormRoot(SCENES)', () => {
    const e = entrySources('/r/data/longform/ep/remotion-entry', path.join('/r/data/longform/ep/scenes', 'registry.ts'), repo);
    expect(e.index).toContain('registerRoot(Root)');
    expect(e.root).toContain("from '../../../../remotion/longform/Root'");
    expect(e.root).toContain("from '../scenes/registry'");
  });
});
