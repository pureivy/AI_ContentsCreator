import { describe, expect, it } from 'vitest';
import { lintScene, sceneTexts, scanSource, textOverlap } from './sceneLint';
import { approxWords } from './sceneRules';

const SENT = '블루베리는 산성 흙을 좋아해서, 피트모스를 절반 넘게 섞어 pH 4.5에서 5.5로 맞춥니다.';
const GOOD = `// S1 "${SENT}" — 머리 주석의 문장·/* 블록 */ 은 검사하지 않는다(문장 밖 말 '전정가위 사용법'도)
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneStage, type SceneProps, PotSection, SafeLabel, Gauge, atFromWords, ACCENT } from './_kit';

const L_ACID = '산성 흙';
const L_PEAT = '피트모스 절반↑';
const L_PH = 'pH 4.5~5.5';

export default function Scene({ durationInFrames, words }: SceneProps) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tPh = atFromWords(words, '맞춥니다', fps, 124);
  /* 단면 — 피트모스가 절반선을 넘는다 */
  return (
    <SceneStage frames={durationInFrames} backdrop="sky">
      <PotSection id="s007-mix" x={540} y={560} layers={[{ material: 'peat', ratio: 0.55 }]} level={{ ratio: 0.5, label: L_PEAT }} />
      <rect fill="url(#s007-grad)" stroke="url(#kit-frame)" width={f} height={2} />
      <Gauge x={620} y={150} kind="ph" value={5} at={tPh} />
      <SafeLabel x={190} y={530} color={ACCENT}>{L_ACID}</SafeLabel>
      <SafeLabel x={720} y={78}>{L_PH}</SafeLabel>
    </SceneStage>
  );
}
`;

describe('scanSource', () => {
  it('주석을 걷고 문자열 조각을 뽑는다(템플릿 보간은 빼고)', () => {
    const r = scanSource("// 주석 '가'\nconst a = 'x'; /* '나' */ const b = `앞${'안'}뒤`;");
    expect(r.code).not.toContain('주석');
    expect(r.strings.map((s) => s.text)).toEqual(['x', '앞', '안', '뒤']);
  });
});

describe('lintScene — 장면 파일 빠른 검사', () => {
  it('키트 계약대로 쓴 장면은 통과(주석 속 문장 밖 말은 무시)', () => {
    expect(lintScene(GOOD, 's007', SENT)).toEqual([]);
    expect(sceneTexts(GOOD).filter((t) => t.label).map((t) => t.text)).toEqual(['산성 흙', '피트모스 절반↑', 'pH 4.5~5.5']);
  });
  it('결정성·외부 자원·import 위반', () => {
    const bad = GOOD.replace('const f = useCurrentFrame();', 'const f = useCurrentFrame() + Math.random() + Date.now();')
      .replace("from './_kit';", "from '../../illus/Kit2';\nimport x from 'https://evil.example/x.js';")
      .replace('<Gauge', '<img src="a.png" /><filter id="s007-f" /><Gauge');
    const p = lintScene(bad, 's007', SENT).join('\n');
    expect(p).toContain('Math.random');
    expect(p).toContain('Date');
    expect(p).toContain("import 금지 모듈: '../../illus/Kit2'");
    expect(p).toContain('외부 주소');
    expect(p).toContain('이미지');
    expect(p).toContain('<filter>');
  });
  it('id·url 참조는 장면 키 접두사(공용 kit-·k2- 참조만 예외)', () => {
    const p = lintScene(GOOD.replace('"s007-mix"', '"mix"').replace('url(#s007-grad)', 'url(#grad)'), 's007', SENT);
    expect(p).toContain("id 'mix' 에 접두사 's007-' 가 없음");
    expect(p.some((x) => x.includes('url(#grad)'))).toBe(true);
    expect(lintScene(GOOD, 's008', SENT).some((x) => x.includes("'s008-'"))).toBe(true);
  });
  it('문장 밖 문구·숫자, 라벨 수·길이', () => {
    const p = lintScene(GOOD.replace("'산성 흙'", "'석회 고토 비료'").replace("'pH 4.5~5.5'", "'pH 6.5'")
      .replace('<SafeLabel x={720}', '<SafeLabel x={1}>{\'피트모스\'}</SafeLabel><SafeLabel x={720}'), 's007', SENT).join('\n');
    expect(p).toContain('문장 밖 문구: "석회 고토 비료"');
    expect(p).toContain('문장에 없는 숫자: "pH 6.5" (6.5)');
    expect(p).toContain('라벨 4개');
    const long = lintScene(GOOD.replace("'산성 흙'", "'산성 흙을 좋아해서 섞어'"), 's007', SENT).join('\n');
    expect(long).toContain('라벨 너무 김');
  });
  it('기본 내보내기 하나·SceneStage 필수', () => {
    const p = lintScene(GOOD.replace('export default function', 'export function').replace(/SceneStage/g, 'Stage'), 's007', SENT);
    expect(p.some((x) => x.includes('기본 내보내기'))).toBe(true);
    expect(p).toContain('SceneStage 무대를 쓰지 않음');
  });
  it('textOverlap — 조사·띄어쓰기 달라도 문장 말이면 높다', () => {
    expect(textOverlap('물 빠짐 구멍', '바닥에 물 빠짐 구멍이 있는지')).toBe(1);
    expect(textOverlap('전정가위', SENT)).toBe(0);
    expect(textOverlap('30cm', SENT)).toBe(1); // 한글 없음 — 숫자는 따로 본다
  });
});

describe('approxWords — 글자 비례 단어 시각', () => {
  it('첫 단어 0초, 말하는 구간 안에서 단조 증가', () => {
    const w = approxWords('가나 다라마 바', 6);
    expect(w).toEqual([{ w: '가나', start: 0 }, { w: '다라마', start: 2 }, { w: '바', start: 5 }]);
    expect(approxWords('', 3)).toEqual([]);
    expect(approxWords('가', 0)).toEqual([]);
  });
});

describe('사람 손 금지(2026-10-23, 전체 화면 장면)', () => {
  const src = "import React from 'react';\nimport { FullStage, Hand } from './_kit';\nexport default function Scene() { return <FullStage frames={1}><Hand x={1} y={2} pose=\"hold\" /></FullStage>; }\n";
  it('noHands 면 Hand 부품을 문제로', () => {
    expect(lintScene(src, 's001', '묘목', { stage: 'FullStage', noHands: true }).some((p) => p.startsWith('사람 손(Hand) 금지'))).toBe(true);
    expect(lintScene(src, 's001', '묘목', { stage: 'FullStage' }).some((p) => p.startsWith('사람 손'))).toBe(false);
  });
});
