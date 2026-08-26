// verified-<brand>.md 소급 정리 실행기 — 실행: npx tsx scripts/verified_cleanup.ts --brand=bionditree [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { partitionVerified } from '../src/agents/verifiedCleanup';

const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const brand = arg('brand');
const dry = process.argv.includes('--dry-run');
if (!brand) { console.error('사용법: --brand=<slug> [--dry-run]'); process.exit(1); }

const agentsDir = path.join(process.cwd(), 'data', 'agents');
let total = 0;
for (const id of fs.readdirSync(agentsDir)) {
  const f = path.join(agentsDir, id, `verified-${brand}.md`);
  if (!fs.existsSync(f)) continue;
  const { keep, archive } = partitionVerified(fs.readFileSync(f, 'utf-8'));
  if (!archive.length) { console.log(`${id}: 정리 대상 없음`); continue; }
  total += archive.length;
  console.log(`${id}: ${archive.length}줄 이동${dry ? '(dry-run)' : ''}`);
  if (dry) { archive.slice(0, 3).forEach((l) => console.log(`   ${l.slice(0, 110)}`)); continue; }
  fs.appendFileSync(
    path.join(agentsDir, id, `verified_archive-${brand}.md`),
    `\n## ${new Date().toISOString().slice(0, 10)} 소급 정리(근거 규칙 미달)\n${archive.join('\n')}\n`,
    'utf-8',
  );
  fs.writeFileSync(f, keep.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf-8');
}
console.log(`합계 ${total}줄`);
