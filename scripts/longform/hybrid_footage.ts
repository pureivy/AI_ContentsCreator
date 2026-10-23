/**
 * 혼합(H) 롱폼 견본 — 실촬영 준비(2026-10-23, 옵트인 견본). types.json 의 card·footage 세그먼트마다 주인공 수종(감나무) 영상만 잘라
 *   clips/H-<seg>-fg.mp4  세로 720×1280 선명본(footage 갈래 — 가운데 세로 카드)
 *   clips/H-<seg>-bg.mp4  가로 960×540 흐림본(footage 바탕 채움 + card 바탕)
 * 을 만든다. 원본 폰 영상은 회전 메타(rotation=-90)가 붙어 있어 반드시 다시 인코딩한다(ffmpeg 자동 회전 → 회전 메타 없는 결과).
 * 만든 뒤 ffprobe 로 크기·회전 메타를 확인한다(뒤집힘·늘어짐 방지). 다른 수종 영상은 쓰지 않는다.
 * 실행: tsx scripts/longform/hybrid_footage.ts <편 폴더>
 * 결과: <편 폴더>/footage-h.json — 세그먼트 id → { media, file, startSec, seconds, fg?, bg }
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONFIG } from '../../src/config';
import { loadMediaVideos } from '../../src/longform/episode';
import type { Timeline } from '../../src/longform/timeline';

const HERO = '감나무';
// 견본용 손 분류(보관소에 나이 태그가 없다) — 어린 나무가 줄지어 선 밭 / 열매 달린 큰 나무. 제품화하면 태그로 바꾼다.
const YOUNG = new Set(['media_7b03cc970e', 'media_0372ccb979']);

const [dirArg] = process.argv.slice(2);
if (!dirArg) throw new Error('사용법: hybrid_footage.ts <편 폴더>');
const dir = path.resolve(dirArg);
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Timeline;
const types = JSON.parse(fs.readFileSync(path.join(dir, 'types.json'), 'utf8')) as { segments: Array<{ id: string; type: string }> };
const typeOf = new Map(types.segments.map((s) => [s.id, s.type]));
const media = loadMediaVideos(CONFIG.dataDir).filter((m) => m.species === HERO).sort((a, b) => a.id.localeCompare(b.id));
if (!media.length) throw new Error(`${HERO} 실촬영 없음`);
const pools = { young: media.filter((m) => YOUNG.has(m.id)), mature: media.filter((m) => !YOUNG.has(m.id)) };
const cursor = new Map<string, number>(media.map((m) => [m.id, 0.6]));
const turn = { young: 0, mature: 0 };

const clips = path.join(dir, 'clips');
fs.mkdirSync(clips, { recursive: true });
const plan: Record<string, { media: string; file: string; startSec: number; seconds: number; fg?: string; bg: string }> = {};
const probe = (f: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', f], { encoding: 'utf8' });

for (const s of tl.segments) {
  const type = typeOf.get(s.id);
  if (type !== 'card' && type !== 'footage') continue;
  const kind = /묘목|어린|접목묘/.test(s.narration) && pools.young.length ? 'young' : 'mature';
  const pool = pools[kind].length ? pools[kind] : media;
  const seconds = Math.round((s.frames / 30 + 0.4) * 100) / 100;
  // 같은 갈래 안에서 영상을 번갈아, 영상마다 앞에서부터 겹치지 않게 잘라 쓴다 — 차례 영상에 자리가 없으면 남은 자리가 가장 큰 영상(그래도 없으면 처음으로).
  const room = (x: typeof media[number]) => x.seconds - 0.5 - cursor.get(x.id)!;
  let m = pool[turn[kind]++ % pool.length]!;
  if (room(m) < seconds) m = [...pool].sort((a, b) => room(b) - room(a))[0]!;
  let start = cursor.get(m.id)!;
  if (start + seconds > m.seconds - 0.5) start = 0.6;
  cursor.set(m.id, start + seconds);
  const fg = `H-${s.id}-fg.mp4`;
  const bg = `H-${s.id}-bg.mp4`;
  const common = ['-v', 'error', '-y', '-ss', String(start), '-t', String(seconds), '-i', m.file, '-an', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  if (type === 'footage') {
    execFileSync('ffmpeg', [...common.slice(0, 9), '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280', ...common.slice(9), '-crf', '19', '-preset', 'medium', path.join(clips, fg)]);
  }
  execFileSync('ffmpeg', [...common.slice(0, 9), '-vf', 'scale=960:540:force_original_aspect_ratio=increase,crop=960:540,gblur=sigma=16,eq=saturation=0.9', ...common.slice(9), '-crf', '24', '-preset', 'medium', path.join(clips, bg)]);
  for (const f of type === 'footage' ? [fg, bg] : [bg]) {
    const j = JSON.parse(probe(path.join(clips, f))) as { streams: Array<{ width: number; height: number; side_data_list?: Array<{ rotation?: number }> }> };
    const st = j.streams[0]!;
    const want = f.endsWith('-fg.mp4') ? [720, 1280] : [960, 540];
    const rot = st.side_data_list?.find((x) => x.rotation != null)?.rotation ?? 0;
    if (st.width !== want[0] || st.height !== want[1] || rot !== 0) throw new Error(`${f}: ${st.width}×${st.height} 회전 ${rot} — 기대 ${want.join('×')} 회전 0`);
  }
  plan[s.id] = { media: m.id, file: path.basename(m.file), startSec: Math.round(start * 100) / 100, seconds, ...(type === 'footage' ? { fg } : {}), bg };
  console.log(`  ${s.id.padEnd(13)} ${type.padEnd(8)} ${kind.padEnd(6)} ${m.id} @${start.toFixed(1)}s ${seconds}s`);
}
fs.writeFileSync(path.join(dir, 'footage-h.json'), JSON.stringify(plan, null, 2));
console.log(`[실촬영] ${Object.keys(plan).length}개 세그먼트 · ${HERO} 영상 ${new Set(Object.values(plan).map((p) => p.media)).size}개 사용`);
