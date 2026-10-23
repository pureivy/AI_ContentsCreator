/**
 * 전체 화면 장면 단계 실행(2026-10-23 견본 — 옵트인). 편 폴더의 timeline.json 세그먼트로 buildScenes(…, { stage: 'full', style }).
 * 실행: tsx scripts/longform/full_scenes.ts <편 폴더> <A|B> [--chapter-total N] [--max-turns N] [--presenter] [--dry]
 * --presenter: 진행자 비온이가 켜진 편처럼(장면 담당 지시문에 비온이 문서 — 왼쪽 아래 자리 비우기·문장마다 bioneeCues).
 * --dry: 에이전트 대신 키트 예시 장면(E2/E1)을 써 넣는 가짜 세션(배선 확인용, 비용 0).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildScenes, type AgentRunInput, type SceneDeps } from '../../src/orchestrator/longformScenes';
import { designerBrief } from '../../src/orchestrator/longformStaff';
import type { Timeline } from '../../src/longform/timeline';
import type { SceneJob } from '../../src/longform/sceneJob';

const [dirArg, style] = process.argv.slice(2) as [string, 'A' | 'B'];
const dir = path.resolve(dirArg ?? '');
if (!dirArg || (style !== 'A' && style !== 'B')) throw new Error('사용법: full_scenes.ts <편 폴더> <A|B> [--chapter-total N] [--max-turns N] [--dry]');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : undefined; };
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;

// 본편(longform.ts)과 같은 디자이너(차민혁) 기억·스킬 — 견본도 같은 규칙(사람 손 금지·비온이 신호 등)으로 그린다(2026-10-23). activity.log 는 견본이라 남기지 않는다.
const over: Partial<SceneDeps> = { designerBrief: () => designerBrief(), ...(arg('--max-turns') ? { maxTurns: arg('--max-turns')! } : {}), ...(arg('--concurrency') ? { concurrency: arg('--concurrency')! } : {}), batchTimeoutMs: 60 * 60_000 };
if (process.argv.includes('--dry')) {
  over.runAgent = async (o: AgentRunInput) => {
    const job = JSON.parse(fs.readFileSync(path.join(o.workDir, 'job.json'), 'utf8')) as SceneJob;
    const repo = process.cwd();
    for (const s of job.scenes) {
      const inset = s.full?.footage ? `\n      overlay={<FootageInset footage={footage} x={1450} y={470} h={460} at={10} />}` : '';
      fs.writeFileSync(path.join(o.workDir, s.file), [
        "import React from 'react';",
        `import { FootageInset, FullStage, GroundLine, Tree, type FullSceneProps } from './_kit';`,
        '',
        'export default function Scene({ durationInFrames, footage }: FullSceneProps) {',
        `  return (\n    <FullStage frames={durationInFrames}${inset}>`,
        `      <GroundLine x0={200} x1={1200} y={780} />\n      <Tree x={650} y={780} h={560} age="mature" seed="${s.key}-t" at={0} grow={30} />`,
        '    </FullStage>\n  );\n}\n',
      ].join('\n'));
    }
    const k = job.scenes[0]!.key;
    console.log('[dry] check', execFileSync(path.join(o.workDir, 'check.sh'), [k], { encoding: 'utf8' }).slice(0, 400));
    console.log('[dry] preview', execFileSync(path.join(o.workDir, 'preview.sh'), [k], { encoding: 'utf8', timeout: 300_000 }).slice(0, 600));
    return { exit: 0, aborted: false, durationSec: 0, costUsd: 0, turns: 0 };
  };
}
const t0 = Date.now();
const r = await buildScenes(dir, tl.segments, undefined, over, { stage: 'full', style, ...(arg('--chapter-total') ? { chapterTotal: arg('--chapter-total')! } : {}), ...(process.argv.includes('--presenter') ? { presenter: true } : {}) });
console.log(`[장면] ${dir} 스타일 ${style} — 통과 ${r.built}/${tl.segments.length} · $${r.costUsd} · ${((Date.now() - t0) / 60000).toFixed(1)}분 · 진입점 ${r.entryPoint ?? '-'} · 대조표 ${r.contact ?? '-'}`);
