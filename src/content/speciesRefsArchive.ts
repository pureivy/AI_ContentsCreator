/**
 * 자료실 → 수종 정답 사진(2026-11-09 사장님) — 자료실에 사진·영상이 올라오면 수종 태그를 보고
 * data/species-refs/<학명>/ 에 '우리 농원 실촬영' 정답 사진으로 넣는다(사진은 줄여서, 영상은 한 장면을 떼어서).
 * 그림 검수(qaSceneImages)가 speciesRefPhotos 로 읽어 판정 대상 옆에 놓고 비교한다.
 *
 * - 사전에 없는 수종(학명 모름)은 넣지 않는다 — 폴더 이름이 학명이다.
 * - 수종마다 농원 사진은 최신 ARCHIVE_KEEP 장까지. 밀려난 파일과 지운 자료의 파일은 휴지통으로(rm 금지 규칙).
 * - 태그가 틀리면 틀린 정답이 들어간다 — 자료실의 수종 태그를 고치면(PATCH) 옛 폴더에서 빼고 새 폴더로 옮긴다.
 * - 실패는 무해(로그만). 업로드 응답을 기다리게 하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';
import { findSpeciesLoose, speciesRefId } from './species';
import type { MediaItem } from './mediaLibrary';

const run = promisify(execFile);
export const ARCHIVE_KEEP = 5;

interface RefPhoto { file: string; role: string; use?: string; source?: string; media?: string; tags?: string[]; added?: string; [k: string]: unknown }
interface RefsJson { name?: string; latin?: string; photos: RefPhoto[] }

const refsRoot = (): string => path.join(CONFIG.dataDir, 'species-refs');
const fileFor = (mediaId: string): string => `m_${mediaId.replace(/[^\w-]/g, '')}.jpg`;

function readRefs(dir: string): RefsJson {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'refs.json'), 'utf-8')) as RefsJson; return { ...j, photos: Array.isArray(j.photos) ? j.photos : [] }; }
  catch { return { photos: [] }; }
}
function writeRefs(dir: string, j: RefsJson): void {
  const tmp = path.join(dir, `refs.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(j, null, 1), 'utf-8');
  fs.renameSync(tmp, path.join(dir, 'refs.json'));
}
async function toTrash(p: string): Promise<void> {
  if (!fs.existsSync(p)) return;
  try { await run('trash', [p]); } catch { /* 휴지통 실패 — 파일은 남겨 둔다(지우지 않는다) */ }
}

/** 농원 사진 목록 정리(순수) — 같은 자료는 하나만, 최신 keep 장만 남기고 밀려난 파일 이름을 돌려준다. */
export function pruneArchive(photos: readonly RefPhoto[], keep = ARCHIVE_KEEP): { photos: RefPhoto[]; dropped: string[] } {
  const others = photos.filter((p) => p.role !== 'archive');
  const seen = new Set<string>();
  const dup: string[] = [];
  const arch = photos.filter((p) => p.role === 'archive')
    .sort((a, b) => String(b.added ?? '').localeCompare(String(a.added ?? '')))
    .filter((p) => { const k = p.media ?? p.file; if (seen.has(k)) { dup.push(p.file); return false; } seen.add(k); return true; });
  const kept = arch.slice(0, keep);
  const keptFiles = new Set(kept.map((p) => p.file));
  // 같은 파일 이름을 다시 쓴 경우(같은 자료 재추가)는 휴지통으로 보내면 새 파일까지 사라진다 — 남은 목록의 파일은 빼고 돌려준다.
  const dropped = [...dup, ...arch.slice(keep).map((p) => p.file)].filter((f) => !keptFiles.has(f));
  return { photos: [...others, ...kept], dropped };
}

/** 자료 한 건을 그 수종의 정답 사진에 넣는다. 결과 한 줄(로그용). */
export async function addArchiveRef(m: Pick<MediaItem, 'id' | 'file' | 'kind' | 'species' | 'tags' | 'seconds'>): Promise<string> {
  if (!CONFIG.speciesRefsArchive) return '꺼짐';
  const sp = m.species ? findSpeciesLoose(m.species) : undefined;
  if (!sp?.latin) return `건너뜀 — 사전에 없는 수종(${m.species ?? '태그 없음'})`;
  if (!fs.existsSync(m.file)) return '건너뜀 — 파일 없음';
  const dir = path.join(refsRoot(), speciesRefId(sp.latin));
  fs.mkdirSync(dir, { recursive: true });
  const name = fileFor(m.id);
  const out = path.join(dir, name);
  const tmp = `${out}.tmp.jpg`;
  if (m.kind === 'image') {
    await run('sips', ['-Z', '800', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', m.file, '--out', tmp]);
  } else {
    const at = Math.max(0, Math.min(2, (m.seconds ?? 4) * 0.3)); // 첫 프레임은 흔들림·검은 화면이 많다
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(at), '-i', m.file, '-frames:v', '1', '-vf', 'scale=800:-2', '-q:v', '4', tmp]);
  }
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 2000) { await toTrash(tmp); return '실패 — 장면을 못 뗐음'; }
  fs.renameSync(tmp, out);
  const j = readRefs(dir);
  const photos = j.photos.filter((p) => p.media !== m.id);
  photos.push({ file: name, role: 'archive', use: 'any', source: '보관소 실촬영', media: m.id, ...(m.tags?.length ? { tags: m.tags } : {}), added: new Date().toISOString() });
  const pr = pruneArchive(photos);
  writeRefs(dir, { name: j.name ?? sp.name, latin: j.latin ?? sp.latin, photos: pr.photos });
  for (const f of pr.dropped) await toTrash(path.join(dir, f));
  return `${sp.name} 정답 사진에 추가`;
}

/** 자료 한 건을 모든 수종의 정답 사진에서 뺀다(삭제·수종 태그 변경). */
export async function removeArchiveRef(mediaId: string): Promise<number> {
  const root = refsRoot();
  let n = 0;
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(root); } catch { return 0; }
  for (const d of dirs) {
    const dir = path.join(root, d);
    const j = readRefs(dir);
    const hit = j.photos.filter((p) => p.media === mediaId);
    if (!hit.length) continue;
    writeRefs(dir, { ...j, photos: j.photos.filter((p) => p.media !== mediaId) });
    for (const p of hit) { await toTrash(path.join(dir, p.file)); n++; }
  }
  return n;
}

/**
 * 새로 등재된 수종의 정답 사진 모으기(2026-11-09 사장님 "사전에 없는 수종은 등재") — 위키미디어 공용(자유 이용 라이선스)과
 * 보관소 실촬영을 scripts/species_refs/collect.py·build.py 로 그 한 종만 모아 data/species-refs 에 넣는다.
 * 사진 대조(이 종이 아닌 사진 빼기)는 하지 않는다 — 검토표에서 사람이 보고 지운다. 결과 한 줄(로그용).
 */
export async function collectRefsForSpecies(name: string, latin: string): Promise<string> {
  if (!CONFIG.speciesRefsArchive) return '꺼짐';
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sprefs-new-'));
  try {
    const one = path.join(tmp, 'one.json');
    fs.writeFileSync(one, JSON.stringify([{ id: speciesRefId(latin), name, latin }]), 'utf-8');
    fs.mkdirSync(path.join(tmp, 'results'));
    const scripts = path.resolve('scripts', 'species_refs');
    await run('python3', ['-I', path.join(scripts, 'collect.py'), one, path.join(CONFIG.dataDir, 'media', 'index.json'), path.join(tmp, 'refs')], { timeout: 300_000 });
    const r = await run('python3', ['-I', path.join(scripts, 'build.py'), path.join(tmp, 'refs'), path.join(tmp, 'results'), refsRoot()], { timeout: 120_000 });
    return String(r.stdout).trim().split('\n')[0] ?? '완료';
  } finally {
    await toTrash(tmp);
  }
}
