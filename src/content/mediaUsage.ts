/**
 * 보관소 사용 현황(2026-09-08 사용자 결정) — "보관소에 있는 수종마다 블로그가 나갔는지, 영상이 실제로
 * 화면에 들어갔는지를 한 표로 보고, 주제는 내가 손으로 넣겠다."
 *
 * 왜 사람이 보는 표인가. 자율런의 주제 선정은 게이트가 여러 겹(검색량·수종 상한·축 상한·쿨다운)이라
 * 재고를 코드로 밀어 넣으면 어디선가 튕긴다. 어느 영상을 지금 쓸지는 밭을 아는 사람이 더 잘 안다.
 * 그래서 선정 로직은 두고(mediaStock 의 동점 처리 그대로), 판단에 필요한 사실만 정확히 보여 준다.
 *
 * '사용'의 근거 두 겹:
 *  · 정확(exact): 굽는 단계가 남긴 clips/sources.json — 어느 파일이 어느 편 몇 번째 씬에 들어갔는지.
 *    (applyUserSegments 가 2026-09-08 부터 기록한다.)
 *  · 추정(estimated): 기록이 생기기 전 편은 clips/user_NN.mp4 존재 + 제목의 수종으로 '이 수종 영상이
 *    쓰였다'까지만 안다. 어느 파일인지는 모른다. 표에 '추정'으로 구분해 보여 준다.
 *
 * 블로그 발행과 영상 사용은 별개의 열이다 — 감나무처럼 글은 4편인데 영상은 한 번도 안 쓰인 경우가 있다.
 * 한 칸에 섞으면 판단이 틀어진다.
 *
 * 전부 순수 함수 — 파일 읽기는 호출측(server)이 deps 로 넘긴다. 실시간이 되는 이유가 이것이다:
 * 저장된 상태가 없고 요청 때마다 현재 파일들로 다시 계산한다.
 */
import type { ShortsPlatform } from './shortsPlatform';

/** 굽는 단계가 남기는 기록 파일(편 폴더 기준 상대 경로). */
export const SOURCES_FILE = 'clips/sources.json';

/** clips/sources.json 의 한 줄 — 이 편의 scene 번째 씬에 file 의 startSec 부터 seconds 만큼이 들어갔다. */
export interface UsageSource {
  /** 1부터 — 사람이 보는 씬 번호. */
  readonly scene: number;
  /** 원본 파일 절대경로(보관소 MediaItem.file 또는 컴포저 첨부). */
  readonly file: string;
  readonly startSec: number;
  readonly seconds: number;
}

export interface MediaLike {
  readonly id: string;
  readonly file: string;
  readonly kind: 'image' | 'video';
  readonly name?: string;
  readonly seconds?: number;
  readonly species?: string;
  readonly tags?: readonly string[];
  readonly createdTs: string;
}
export interface PieceLike {
  readonly id: string;
  readonly title: string;
  readonly keyword?: string;
  readonly stage: string;
  readonly publishedUrl?: string;
  readonly privateUrl?: string;
  readonly publishedTs?: string;
  readonly createdTs: string;
}
export interface ShortsLike {
  readonly id: string;
  readonly topic: string;
  readonly title?: string;
  readonly keyword?: string;
  readonly platform?: ShortsPlatform;
  readonly stage: string;
  readonly sourcePieceId?: string;
  readonly youtubeId?: string;
  readonly youtubeUrl?: string;
  readonly youtubeTs?: string;
  readonly igReelId?: string;
  readonly igPermalink?: string;
  readonly metaPublishedTs?: string;
  readonly createdTs: string;
}

export type BlogStatus = 'public' | 'private' | 'ready' | 'none';

/** 채널별 최신 링크 — 표의 '링크' 열(아이콘). 실촬영 사용과 무관하게 그 수종으로 올라간 것 중 최신. */
export interface ChannelLink { readonly url: string; readonly title: string; readonly ts: string }
export interface SpeciesLinks { readonly blog?: ChannelLink; readonly youtube?: ChannelLink; readonly instagram?: ChannelLink }

export interface ShortsUse {
  readonly shortId: string;
  readonly title: string;
  readonly platform?: ShortsPlatform;
  /** 어느 씬에 들어갔나(정확 기록일 때만). */
  readonly scenes: readonly number[];
  /** true = sources.json 기록, false = user_NN.mp4 + 제목 수종으로 추정. */
  readonly exact: boolean;
  readonly youtubeId?: string;
  readonly igReelId?: string;
  /** 편이 만들어진 시각 — '마지막 사용' 계산 기준. */
  readonly ts: string;
}

export interface SpeciesUsageRow {
  /** 표준명(사전) — 딱지가 '백일홍'이어도 여기는 '배롱나무'. */
  readonly species: string;
  /** 사장님이 적은 딱지들(표준명과 다른 것만). */
  readonly labels: readonly string[];
  readonly images: number;
  readonly videos: number;
  readonly tags: readonly string[];
  readonly firstAddedTs: string;
  readonly blog: {
    readonly status: BlogStatus;
    /** 공개 발행 편수(status 가 public 일 때). */
    readonly count: number;
    readonly latest?: { readonly id: string; readonly title: string; readonly ts: string; readonly url?: string };
  };
  readonly shorts: readonly ShortsUse[];
  readonly lastUsedTs?: string;
  /** 영상이 한 번도 화면에 안 들어갔다(정확·추정 모두 없음). 사장님이 볼 목록의 기준. */
  readonly unused: boolean;
  /** 채널별 최신 링크(2026-09-08 사용자 요청 "제목 대신 아이콘에 링크") — 블로그·유튜브·인스타. 없으면 키 없음. */
  readonly links: SpeciesLinks;
}

export interface FileUse {
  readonly shortId: string;
  readonly title: string;
  readonly platform?: ShortsPlatform;
  readonly scene: number;
  readonly youtubeId?: string;
  readonly igReelId?: string;
  readonly ts: string;
}

export interface MediaUsage {
  readonly species: readonly SpeciesUsageRow[];
  /** 파일(MediaItem.id)별 정확 사용 기록. 기록 없는 파일은 키가 없다. */
  readonly files: Readonly<Record<string, readonly FileUse[]>>;
  readonly summary: { readonly species: number; readonly unused: number; readonly blogNone: number; readonly estimatedShorts: number };
}

export interface UsageDeps {
  /** 편 폴더의 sources.json — 없으면 null. */
  readonly sourcesOf: (shortId: string) => readonly UsageSource[] | null;
  /** 편 폴더에 clips/user_NN.mp4 가 있는가(추정 근거). */
  readonly hasUserClip: (shortId: string) => boolean;
  /** 제목·키워드에서 수종 표준명. 못 찾으면 undefined. */
  readonly speciesOf: (text: string) => string | undefined;
  /** 딱지 → 표준명. 사전이 모르면 그대로. */
  readonly canon: (name: string) => string;
}

const norm = (p: string): string => p.replace(/\\/g, '/').trim();

/**
 * 블로그 상태(순수). 공개 발행이 하나라도 있으면 public(편수 = 공개 편수). 없으면 비공개 발행 → 검토 대기 → 없음.
 * 최근 글은 그 상태 안에서 가장 최근 것(공개면 발행일 기준, 나머지는 작성일).
 */
export function blogStatusOf(posts: readonly PieceLike[]): SpeciesUsageRow['blog'] {
  if (!posts.length) return { status: 'none', count: 0 };
  const pub = posts.filter((p) => !!p.publishedUrl)
    .sort((a, b) => (b.publishedTs ?? b.createdTs).localeCompare(a.publishedTs ?? a.createdTs));
  if (pub.length) {
    const l = pub[0]!;
    return { status: 'public', count: pub.length, latest: { id: l.id, title: l.title, ts: l.publishedTs ?? l.createdTs, url: l.publishedUrl } };
  }
  const priv = posts.filter((p) => !!p.privateUrl).sort((a, b) => b.createdTs.localeCompare(a.createdTs));
  if (priv.length) { const l = priv[0]!; return { status: 'private', count: 0, latest: { id: l.id, title: l.title, ts: l.createdTs, url: l.privateUrl } }; }
  const ready = posts.filter((p) => p.stage === 'ready').sort((a, b) => b.createdTs.localeCompare(a.createdTs));
  if (ready.length) { const l = ready[0]!; return { status: 'ready', count: 0, latest: { id: l.id, title: l.title, ts: l.createdTs } }; }
  const l = [...posts].sort((a, b) => b.createdTs.localeCompare(a.createdTs))[0]!;
  return { status: 'none', count: 0, latest: { id: l.id, title: l.title, ts: l.createdTs } };
}

/**
 * 보관소 × 블로그 × 쇼츠를 수종별 한 줄로(순수).
 * 정렬: 미사용 먼저(사장님이 볼 것), 그 안에서 영상 많은 순, 같으면 이름순.
 */
export function buildMediaUsage(
  input: { media: readonly MediaLike[]; pieces: readonly PieceLike[]; shorts: readonly ShortsLike[] },
  deps: UsageDeps,
): MediaUsage {
  const canon = (n: string): string => { try { return String(deps.canon(n) ?? n).trim() || n; } catch { return n; } };
  const speciesOf = (t: string): string | undefined => { try { return deps.speciesOf(t); } catch { return undefined; } };

  // 1) 보관소를 표준명으로 묶는다.
  type Acc = { labels: Set<string>; images: number; videos: number; tags: Set<string>; first: string; fileIds: string[] };
  const bySpecies = new Map<string, Acc>();
  const fileToId = new Map<string, string>();
  for (const m of input.media) {
    fileToId.set(norm(m.file), m.id);
    const label = String(m.species ?? '').trim();
    if (!label) continue; // 무표기 범용 소재는 수종 표에 안 오른다
    const key = canon(label);
    const acc = bySpecies.get(key) ?? { labels: new Set(), images: 0, videos: 0, tags: new Set(), first: m.createdTs, fileIds: [] };
    if (label !== key) acc.labels.add(label);
    if (m.kind === 'image') acc.images++; else acc.videos++;
    (m.tags ?? []).forEach((t) => { const s = String(t).trim(); if (s) acc.tags.add(s); });
    if (m.createdTs < acc.first) acc.first = m.createdTs;
    acc.fileIds.push(m.id);
    bySpecies.set(key, acc);
  }

  // 2) 블로그 글을 수종별로.
  const posts = new Map<string, PieceLike[]>();
  for (const p of input.pieces) {
    const sp = speciesOf(`${p.title} ${p.keyword ?? ''}`);
    if (!sp) continue;
    posts.set(sp, [...(posts.get(sp) ?? []), p]);
  }

  // 3) 쇼츠 사용 — 정확 기록이 있으면 파일→편, 없으면 수종 추정.
  const files: Record<string, FileUse[]> = {};
  const usesBySpecies = new Map<string, ShortsUse[]>();
  let estimatedShorts = 0;
  const pushUse = (sp: string, u: ShortsUse): void => { usesBySpecies.set(sp, [...(usesBySpecies.get(sp) ?? []), u]); };
  for (const s of input.shorts) {
    const title = s.title ?? s.topic;
    const base = { shortId: s.id, title, platform: s.platform, youtubeId: s.youtubeId, igReelId: s.igReelId, ts: s.createdTs };
    let sources: readonly UsageSource[] | null = null;
    try { sources = deps.sourcesOf(s.id); } catch { sources = null; }
    if (sources && sources.length) {
      // 파일 단위 — 어느 수종 줄에 붙일지는 파일의 딱지로 정한다(제목이 아니라). 첨부 파일(보관소 밖)은 수종 줄엔
      // 제목 수종으로 붙이고 파일 표에는 안 오른다.
      const scenesBySpecies = new Map<string, number[]>();
      for (const src of sources) {
        const mid = fileToId.get(norm(src.file));
        const m = mid ? input.media.find((x) => x.id === mid) : undefined;
        if (mid) (files[mid] ??= []).push({ ...base, scene: src.scene });
        const sp = m?.species ? canon(m.species) : speciesOf(`${s.keyword ?? ''} ${title}`);
        if (!sp) continue;
        scenesBySpecies.set(sp, [...(scenesBySpecies.get(sp) ?? []), src.scene]);
      }
      for (const [sp, scenes] of scenesBySpecies) pushUse(sp, { ...base, scenes: [...new Set(scenes)].sort((a, b) => a - b), exact: true });
      continue;
    }
    let has = false; try { has = deps.hasUserClip(s.id); } catch { has = false; }
    if (!has) continue;
    const sp = speciesOf(`${s.keyword ?? ''} ${title}`);
    if (!sp) continue;
    estimatedShorts++;
    pushUse(sp, { ...base, scenes: [], exact: false });
  }

  // 4) 채널별 최신 링크 — 실촬영 사용과 무관하게 '그 수종으로 올라간 것'. 유튜브는 youtubeUrl(없으면 id 로 조립),
  //    인스타는 igPermalink 만(igReelId 는 숫자 미디어 id 라 주소를 만들 수 없다).
  const ytBy = new Map<string, ChannelLink>(); const igBy = new Map<string, ChannelLink>();
  for (const s of input.shorts) {
    const title = s.title ?? s.topic;
    const sp = speciesOf(`${s.keyword ?? ''} ${title}`); if (!sp) continue;
    const ytUrl = s.youtubeUrl || (s.youtubeId ? `https://youtube.com/shorts/${s.youtubeId}` : '');
    if (ytUrl) { const ts = s.youtubeTs ?? s.createdTs; const cur = ytBy.get(sp); if (!cur || ts > cur.ts) ytBy.set(sp, { url: ytUrl, title, ts }); }
    if (s.igPermalink) { const ts = s.metaPublishedTs ?? s.createdTs; const cur = igBy.get(sp); if (!cur || ts > cur.ts) igBy.set(sp, { url: s.igPermalink, title, ts }); }
  }

  // 5) 줄 조립.
  const rows: SpeciesUsageRow[] = [];
  for (const [sp, acc] of bySpecies) {
    const uses = (usesBySpecies.get(sp) ?? []).sort((a, b) => b.ts.localeCompare(a.ts));
    const blog = blogStatusOf(posts.get(sp) ?? []);
    const links: SpeciesLinks = {
      ...(blog.latest?.url ? { blog: { url: blog.latest.url, title: blog.latest.title, ts: blog.latest.ts } } : {}),
      ...(ytBy.has(sp) ? { youtube: ytBy.get(sp)! } : {}),
      ...(igBy.has(sp) ? { instagram: igBy.get(sp)! } : {}),
    };
    rows.push({
      species: sp, labels: [...acc.labels].sort(), images: acc.images, videos: acc.videos, tags: [...acc.tags].sort(),
      firstAddedTs: acc.first, blog, shorts: uses,
      ...(uses.length ? { lastUsedTs: uses[0]!.ts } : {}), unused: uses.length === 0, links,
    });
  }
  rows.sort((a, b) => Number(b.unused) - Number(a.unused) || b.videos - a.videos || (b.images + b.videos) - (a.images + a.videos) || a.species.localeCompare(b.species, 'ko'));
  for (const k of Object.keys(files)) files[k]!.sort((a, b) => b.ts.localeCompare(a.ts) || a.scene - b.scene);
  return {
    species: rows, files,
    summary: { species: rows.length, unused: rows.filter((r) => r.unused).length, blogNone: rows.filter((r) => r.blog.status === 'none').length, estimatedShorts },
  };
}
