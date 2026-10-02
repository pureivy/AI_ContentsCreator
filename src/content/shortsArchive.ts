/**
 * 쇼츠 원본 영상 정리 정책(2026-08-31 사용자 확정) — 발행이 끝난 final.mp4 를 저용량 프록시로 교체한다.
 *
 * 배경(실측): 쇼츠 154건이 20G 를 쓰고 디스크가 96%까지 찼다. 중간물을 걷어낸 뒤 남은 단일 최대
 * 항목이 final.mp4 7.2G(건당 평균 50MB)다. 유튜브·인스타에 이미 올라간 영상이라 로컬 원본은
 * 재발행·재편집 대비로만 남는다.
 *
 * 통째로 지우지 않는 이유: 스튜디오 쇼츠 탭이 이 파일을 그대로 재생한다(/shorts/:id/video → final.mp4).
 * 지우면 지난 영상을 앱에서 다시 볼 수 없다. 그래서 저용량 사본(preview.mp4)으로 바꾼다 —
 * 실측상 재인코딩 사본은 원본의 1/4 안팎이라 7.2G 중 대부분을 회수하면서 미리보기는 살아 있다.
 *
 * 판정을 '두 채널 모두'로 두는 이유: 한쪽만 올라간 상태에서 원본을 없애면 남은 채널 발행에 쓸 소스가
 * 사라진다. 릴스 업로드는 final.mp4(또는 그 재인코딩본 meta.mp4)를 그대로 올린다.
 */

/** 정리 판정 입력 — 쇼츠 레코드에서 발행 확인에 쓰는 필드만. */
export interface ShortsArchiveInput {
  youtubeId?: string;
  igReelId?: string;
  metaPublishedTs?: string;
  /** 이미 정리된 시각 — 있으면 재실행하지 않는다(멱등). */
  videoArchivedTs?: string;
  /** 이 편의 채널(2026-09-08 채널 분리 이후 한 편은 한 채널). 없으면 옛 양채널 편. */
  platform?: string;
  /** 유튜브 업로드 시각 — 클립 대기 기한을 잰다. */
  youtubeTs?: string;
  /** 네이버 클립 번호(mediaContentNo) — 있으면 클립도 끝난 것. */
  naverClipNo?: string;
}

/** 정리 판정 옵션 — 유튜브용 편이 네이버 클립을 기다리는 기한(2026-10-02). 0 이면 기다리지 않는다(종전). */
export interface ShortsArchiveOpts {
  clipWaitDays?: number;
  now?: number;
}

/**
 * 원본을 프록시로 바꿔도 되는가 — 유튜브와 인스타(릴스)가 **둘 다** 확인됐을 때만 true.
 * 인스타 확인은 igReelId(발행 응답) 또는 metaPublishedTs(수집 경로) 어느 쪽이든 인정한다.
 */
export function shouldArchiveShortsVideo(s: ShortsArchiveInput, opts: ShortsArchiveOpts = {}): boolean {
  if (s.videoArchivedTs) return false;
  const yt = !!(s.youtubeId ?? '').trim();
  const meta = !!(s.igReelId ?? '').trim() || !!(s.metaPublishedTs ?? '').trim();
  // 채널 분리(2026-09-08) 이후 한 편은 한 채널에만 간다 — '둘 다' 조건이 영원히 안 맞아 정책이 멈춰 있었다
  // (실측 2026-09-10: 발행됐는데 원본이 남은 편 26개 1.1G). 그 편의 채널이 발행되면 끝난 것이다.
  // 유튜브용 편은 네이버 클립에도 간다(2026-10-02) — 클립은 원본(final.mp4)을 올리므로 유튜브 직후 정리하면
  // 저화질 사본만 남는다. 클립이 올라가거나 기한(clipWaitDays)이 지나면 정리한다. 기한 덕에 원본이 쌓이지 않는다.
  if (s.platform === 'youtube') return yt && (!!(s.naverClipNo ?? '').trim() || clipWaitOver(s.youtubeTs, opts));
  if (s.platform === 'instagram') return meta;
  return yt && meta; // 옛 양채널 편
}

/** 클립 대기 기한이 지났는가 — 기한 0(끔)이거나 업로드 시각을 모르면 기다리지 않는다. */
function clipWaitOver(youtubeTs: string | undefined, opts: ShortsArchiveOpts): boolean {
  const days = opts.clipWaitDays ?? 0;
  if (!(days > 0)) return true;
  const t = Date.parse(youtubeTs ?? '');
  if (!Number.isFinite(t)) return true;
  return (opts.now ?? Date.now()) - t >= days * 86_400_000;
}
