/**
 * 카드뉴스 추가 실촬영 컷(2026-10-15 사장님 제안 — "실제 농원 사진은 영상을 캡처해서 쓰니, 다른 장면을 캡처해서 쓰면 되지 않아?").
 *
 * 왜: HTML 카드는 사진 칸 6~8개를 블로그 사진 3장(실촬영 1 + 생성 2)으로 채우느라 같은 사진이 2~3번씩 나왔다. 새로 그리면
 * 나무가 장마다 달라질 수 있고(숏폼 활착 편 실측) 계절도 어긋날 수 있다. 같은 수종 보관소 영상의 다른 순간을 떼면 실제 나무·
 * 이번 달 모습 그대로다.
 *
 * 무엇: 같은 수종 영상(이번 달 촬영 우선 — matchMediaScored 의 pickShootMonth)에서 간격을 두고 순간을 떼고(captureBlogFrame —
 * 흐림·어두움 거절), 이미 고른 컷·블로그 표지 컷과 화면이 비슷하면(signatureSimilarity ≥ FRAME_SIG_SAME) 버린다. 고른 컷은
 * 비전으로 한 줄 판독해 카드 판형이 장 내용에 맞는 컷을 고르게 한다.
 * 블로그 컷 원장(네이버 중복 이미지 방지)에는 적지 않는다 — 카드는 인스타 게시라 그 규칙 밖이다.
 * 전부 fail-open — 실패하면 빈 배열(종전처럼 블로그 사진 + 생성 사진).
 */
import fs from 'node:fs';
import path from 'node:path';
import { listMedia, matchMediaScored } from '../content/mediaLibrary';
import { findSpeciesLoose } from '../content/species';
import { framePositions, signatureSimilarity, FRAME_SIG_SAME } from '../content/blogFrames';
import { captureBlogFrame } from '../tools/blog_skills';
import { describeUserMedia } from './shortsMediaBrief';

export interface CardFrame { path: string; alt: string; mediaId: string; atSec: number }

/**
 * 순간 순서(순수) — 파일마다 framePositions 간격의 순간을 한가운데부터 바깥으로, 파일을 번갈아 가며 늘어놓는다.
 * 한 파일의 이웃 순간(2.5초 간격)은 화면이 비슷하기 쉬워 파일을 번갈고, 같은 파일 안에서는 멀리 떨어진 순간부터 본다.
 */
export function cardFrameOrder(files: ReadonlyArray<{ mediaId: string; file: string; seconds?: number }>): Array<{ mediaId: string; file: string; atSec: number }> {
  const lists = files.map((f) => {
    const ts = framePositions(f.seconds);
    // 멀리 떨어진 순간부터 — 앞·뒤·가운데를 번갈아(같은 장면 연속 회피)
    const order: number[] = [];
    const step = Math.max(1, Math.round(ts.length / 4));
    for (let k = 0; k < step; k++) for (let i = k; i < ts.length; i += step) order.push(ts[i]!);
    return order.map((t) => ({ mediaId: f.mediaId, file: f.file, atSec: t }));
  });
  const out: Array<{ mediaId: string; file: string; atSec: number }> = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

export async function cardRealFrames(o: {
  topic: string; keyword?: string; brand?: string; cardDir: string; count: number;
  /** 이미 쓰는 실촬영(블로그 표지 컷) — 이것과 비슷한 화면은 고르지 않는다. */
  avoid?: readonly string[];
  maxTries?: number; signal?: AbortSignal; log: (m: string) => void;
}): Promise<CardFrame[]> {
  if (o.count <= 0) return [];
  try {
    const text = `${o.topic} ${o.keyword ?? ''}`.trim();
    const sp = findSpeciesLoose(text)?.name;
    if (!sp) return [];
    const canon = (n: string): string => findSpeciesLoose(n)?.name ?? n;
    const scored = matchMediaScored(listMedia(o.brand), { species: sp, text, limit: 500, canon });
    const top = scored.length ? Math.max(...scored.map((x) => x.grade)) : 0;
    const vids = scored.filter((x) => x.grade === top && x.grade >= 100 && x.item.kind === 'video' && fs.existsSync(x.item.file))
      .map((x) => ({ mediaId: x.item.id, file: x.item.file, seconds: x.item.seconds }));
    if (!vids.length) { o.log(`카드 실촬영 컷 없음 — 보관소에 ${sp} 영상이 없다`); return []; }

    const dir = path.join(o.cardDir, 'photos');
    fs.mkdirSync(dir, { recursive: true });
    // 비교 기준 서명 — 블로그 표지 컷부터
    const sigs: string[] = [];
    for (const a of o.avoid ?? []) {
      const c = await captureBlogFrame({ kind: 'image', file: a, atSec: 0 }, path.join(dir, '_avoid.png'), o.signal).catch(() => null);
      if (c?.sig) sigs.push(c.sig);
    }
    const picked: Array<Omit<CardFrame, 'alt'>> = [];
    const maxTries = o.maxTries ?? o.count * 4;
    let tries = 0;
    for (const m of cardFrameOrder(vids)) {
      if (picked.length >= o.count || tries >= maxTries || o.signal?.aborted) break;
      tries++;
      const out = path.join(dir, `frame-${String(picked.length + 1).padStart(2, '0')}.png`);
      const cap = await captureBlogFrame({ kind: 'video', file: m.file, atSec: m.atSec }, out, o.signal).catch(() => null);
      if (!cap?.ok || !cap.sig || !fs.existsSync(out)) continue; // 흐림·어두움·추출 실패
      if (sigs.some((s) => signatureSimilarity(cap.sig, s) >= FRAME_SIG_SAME)) continue; // 이미 고른 화면과 같아 보인다
      sigs.push(cap.sig);
      picked.push({ path: out, mediaId: m.mediaId, atSec: cap.atSec ?? m.atSec });
    }
    try { fs.rmSync(path.join(dir, '_avoid.png'), { force: true }); } catch { /* 무해 */ }
    if (!picked.length) { o.log(`카드 실촬영 컷 — ${tries}번 시도, 다른 화면을 못 찾음`); return []; }
    // 판독 — 카드 판형이 장 내용에 맞는 컷을 고르도록 무엇이 보이는지 한 줄씩.
    const briefs = await describeUserMedia(picked.map((p) => ({ file: p.path, kind: 'image' as const })), { topic: o.topic, ...(o.keyword ? { keyword: o.keyword } : {}), ...(o.signal ? { signal: o.signal } : {}) }).catch(() => []);
    const frames = picked.map((p, i) => ({ ...p, alt: `${sp} 농원 실촬영 — ${(briefs.find((b) => b.file === p.path) ?? briefs[i])?.what?.slice(0, 70) ?? '다른 장면'}` }));
    o.log(`카드 실촬영 컷 ${frames.length}장 추가 — ${tries}번 시도 · ${frames.map((f) => `${path.basename(f.path)}@${f.atSec}초`).join(', ')}`);
    return frames;
  } catch (e) {
    o.log(`카드 실촬영 컷 실패(무해) — ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    return [];
  }
}
