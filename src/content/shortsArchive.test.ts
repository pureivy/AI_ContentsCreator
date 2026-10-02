import { describe, it, expect } from 'vitest';
import { shouldArchiveShortsVideo } from './shortsArchive';

// 저장공간 정책(2026-08-31 사용자 확정) — final.mp4 는 쇼츠당 평균 50MB, 144건에 7.2G 로 단일 최대
// 항목이다. 유튜브·인스타에 올라간 뒤엔 로컬 원본이 재발행·재편집 대비로만 남는데, 사용자는 "발행
// 확인 즉시" 정리를 택했다. 다만 스튜디오 쇼츠 탭이 이 파일을 그대로 재생하므로(/shorts/:id/video)
// 통째로 지우면 지난 영상을 앱에서 볼 수 없게 된다 → 저용량 프록시(preview.mp4)로 교체한다.
// 판정은 "두 채널 모두 올라갔는가" — 한쪽만 올라간 상태에서 지우면 나머지 발행에 쓸 원본이 사라진다.
describe('shouldArchiveShortsVideo — 원본 정리 판정', () => {
  const both = { youtubeId: 'yt1', igReelId: 'ig1' };

  it('유튜브·인스타 둘 다 확인되면 정리한다', () => {
    expect(shouldArchiveShortsVideo(both)).toBe(true);
  });

  it('인스타는 igReelId 대신 metaPublishedTs 로도 인정한다(수집 경로가 다르다)', () => {
    expect(shouldArchiveShortsVideo({ youtubeId: 'yt1', metaPublishedTs: '2026-08-31T00:00:00Z' })).toBe(true);
  });

  it('유튜브만 올라갔으면 아직 정리하지 않는다 — 릴스 발행에 원본이 필요하다', () => {
    expect(shouldArchiveShortsVideo({ youtubeId: 'yt1' })).toBe(false);
  });

  it('인스타만 올라갔으면 아직 정리하지 않는다 — 유튜브 업로드에 원본이 필요하다', () => {
    expect(shouldArchiveShortsVideo({ igReelId: 'ig1' })).toBe(false);
  });

  it('아무 데도 안 올라갔으면 정리하지 않는다', () => {
    expect(shouldArchiveShortsVideo({})).toBe(false);
  });

  it('빈 문자열은 미발행으로 본다(빈 값이 남아 있는 옛 레코드 방어)', () => {
    expect(shouldArchiveShortsVideo({ youtubeId: '', igReelId: 'ig1' })).toBe(false);
    expect(shouldArchiveShortsVideo({ youtubeId: 'yt1', igReelId: '', metaPublishedTs: '' })).toBe(false);
  });

  it('이미 정리된 건은 다시 정리하지 않는다(videoArchivedTs 있으면 false)', () => {
    expect(shouldArchiveShortsVideo({ ...both, videoArchivedTs: '2026-08-31T00:00:00Z' })).toBe(false);
  });
});

describe('shouldArchiveShortsVideo — 채널 분리(2026-09-08) 이후: 그 편의 채널만 보면 된다', () => {
  it('유튜브 편은 유튜브만 올라가면 정리한다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1' })).toBe(true);
    expect(shouldArchiveShortsVideo({ platform: 'youtube', igReelId: 'ig1' })).toBe(false);
  });
  it('인스타 편은 릴스만 올라가면 정리한다(수집 경로 metaPublishedTs 도 인정)', () => {
    expect(shouldArchiveShortsVideo({ platform: 'instagram', igReelId: 'ig1' })).toBe(true);
    expect(shouldArchiveShortsVideo({ platform: 'instagram', metaPublishedTs: '2026-09-09T00:00:00Z' })).toBe(true);
    expect(shouldArchiveShortsVideo({ platform: 'instagram', youtubeId: 'yt1' })).toBe(false);
  });
  it('채널 표시가 없는 옛 편은 종전대로 둘 다', () => {
    expect(shouldArchiveShortsVideo({ youtubeId: 'yt1' })).toBe(false);
  });
});

describe('shouldArchiveShortsVideo — 유튜브 편은 네이버 클립을 기다린다(2026-10-02)', () => {
  // 클립은 원본 final.mp4 를 올린다. 유튜브 직후 정리하면 저화질 preview.mp4 만 남아 클립에 못 올린다.
  const now = Date.parse('2026-10-10T00:00:00Z');
  const opts = { clipWaitDays: 7, now };
  it('유튜브만 올라가고 기한 안이면 정리하지 않는다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1', youtubeTs: '2026-10-05T00:00:00Z' }, opts)).toBe(false);
  });
  it('클립까지 올라가면 바로 정리한다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1', youtubeTs: '2026-10-09T00:00:00Z', naverClipNo: '7617327' }, opts)).toBe(true);
  });
  it('기한이 지나면 클립 없이도 정리한다 — 원본이 쌓이지 않게', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1', youtubeTs: '2026-10-02T00:00:00Z' }, opts)).toBe(true);
  });
  it('업로드 시각을 모르면 기다리지 않는다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1' }, opts)).toBe(true);
  });
  it('기한 0 이면 종전처럼 유튜브만 보고 정리한다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', youtubeId: 'yt1', youtubeTs: '2026-10-09T00:00:00Z' }, { clipWaitDays: 0, now })).toBe(true);
  });
  it('유튜브가 안 올라갔으면 클립만으로는 정리하지 않는다', () => {
    expect(shouldArchiveShortsVideo({ platform: 'youtube', naverClipNo: '7617327' }, opts)).toBe(false);
  });
});
