/**
 * 롱폼 대본 검사 CLI — validateScript(결정적) + factGateBlog(원문 근거). 로직은 src/longform/check.ts.
 * 실행: pnpm tsx scripts/longform/check.ts [--dir <폴더 이름, 기본 시범>] [--no-gate]
 */
import path from 'node:path';
import { checkEpisode } from '../../src/longform/check';
import { longformRoot, PILOT_DIR_NAME } from '../../src/longform/episode';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
export const OUT_DIR = path.join(longformRoot(), arg('--dir') ?? PILOT_DIR_NAME);

async function main() {
  const r = await checkEpisode(OUT_DIR, { gate: !process.argv.includes('--no-gate') });
  for (const i of r.issues) console.log(`문제: ${i}`);
  console.log(`문제 ${r.issues.length} · 세그먼트 ${r.segments} · 글자(공백 제외) ${r.chars}`);
  let gateBad = 0;
  if (r.gate) {
    for (const t of r.gate.unsupported) console.log(`사실 unsupported: ${t}`);
    for (const t of r.gate.contradicted) console.log(`사실 contradicted: ${t}`);
    gateBad = r.gate.unsupported.length + r.gate.contradicted.length;
    console.log(`unsupported ${r.gate.unsupported.length} · contradicted ${r.gate.contradicted.length} · 판정 ${r.gate.status}`);
  }
  process.exit(r.issues.length + gateBad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
