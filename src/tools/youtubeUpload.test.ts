import { describe, it, expect } from 'vitest';
import { buildVideoMeta, buildMultipartBody, extractVideoId, buildStatusUpdate, classifyThumb } from './youtubeUpload';

describe('buildVideoMeta — 블로그 링크 줄(2026-07-31)', () => {
  it('설명 본문과 태그 줄 사이에 링크, 미지정 시 종전과 동일', () => {
    const url = 'https://blog.naver.com/biondi_tree/224345904342';
    const m = buildVideoMeta('t', '설명', ['#shorts'], url) as { snippet: { description: string } };
    expect(m.snippet.description).toBe(`설명\n\n📖 전체 가이드(블로그): ${url}\n\n#shorts`);
    const none = buildVideoMeta('t', '설명', ['#shorts']) as { snippet: { description: string } };
    expect(none.snippet.description).toBe('설명\n\n#shorts');
  });
});

describe('buildVideoMeta — 캡·해시태그 합성·private·AI 공개 고정(순수)', () => {
  it('꺾쇠 제거·설명에 해시태그 줄·tags 변환(# 제거·빈 항목 제외)', () => {
    const m = buildVideoMeta('제목 <b>테스트</b>', '설명', ['#shorts', '#화분', '']) as {
      snippet: { title: string; description: string; tags: string[]; categoryId: string };
      status: { privacyStatus: string; selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean };
    };
    expect(m.snippet.title).toBe('제목 b테스트/b');
    expect(m.snippet.description).toBe('설명\n\n#shorts #화분');
    expect(m.snippet.tags).toEqual(['shorts', '화분']);
    expect(m.snippet.categoryId).toBe('22');
    expect(m.status.privacyStatus).toBe('private');
    expect(m.status.selfDeclaredMadeForKids).toBe(false);
    // AI 사용 공개('예') — 쇼츠는 전량 AI 생성(스크립트·TTS·배경)이라 상시 선언(유튜브 정책 의무).
    expect(m.status.containsSyntheticMedia).toBe(true);
  });
  it('제목 100자 캡·빈 제목 폴백, 설명 5000자 캡', () => {
    const m = buildVideoMeta('x'.repeat(120), 'y'.repeat(6000), []) as { snippet: { title: string; description: string } };
    expect(m.snippet.title.length).toBe(100);
    expect(m.snippet.description.length).toBe(5000);
    const empty = buildVideoMeta('  ', '', []) as { snippet: { title: string } };
    expect(empty.snippet.title).toBe('쇼츠');
  });
  it('설명·태그의 꺾쇠도 제거(유튜브 API 제약)', () => {
    const m = buildVideoMeta('t', '1->2단계 <중요>', ['#a<b>']) as { snippet: { description: string; tags: string[] } };
    expect(m.snippet.description).toBe('1-2단계 중요\n\n#ab');
    expect(m.snippet.tags).toEqual(['ab']);
  });
});
describe('buildMultipartBody — multipart/related 조립(순수)', () => {
  it('메타 JSON + 비디오 바이트 + 종료 경계', () => {
    const buf = buildMultipartBody({ a: 1 }, Buffer.from('VIDEO'), 'BB');
    const s = buf.toString('utf-8');
    expect(s.startsWith('--BB\r\n')).toBe(true);
    expect(s).toContain('{"a":1}');
    expect(s).toContain('Content-Type: video/mp4');
    expect(s).toContain('VIDEO');
    expect(s.endsWith('\r\n--BB--\r\n')).toBe(true);
  });
});
describe('extractVideoId — 정상/이형(순수)', () => {
  it('비어있지 않은 문자열 id 만 통과', () => {
    expect(extractVideoId({ id: 'abc123' })).toBe('abc123');
    expect(extractVideoId({})).toBeNull();
    expect(extractVideoId(null)).toBeNull();
    expect(extractVideoId({ id: 5 })).toBeNull();
    expect(extractVideoId({ id: '' })).toBeNull();
  });
});

// 공개 발행(2026-10-01 사용자 확정) — 비공개 + 예약 공개 안전망으로 올리고, 처리 뒤 공개 전환·썸네일 확인.
describe('buildVideoMeta — 예약 공개 안전망(publishAt, 2026-10-01)', () => {
  it('publishAt 을 주면 비공개 + publishAt, 안 주면 종전대로 비공개만', () => {
    const at = '2026-10-01T03:30:00.000Z';
    const m = buildVideoMeta('t', 'd', [], undefined, at) as { status: Record<string, unknown> };
    expect(m.status.privacyStatus).toBe('private'); // publishAt 은 비공개일 때만 걸린다(API 제약)
    expect(m.status.publishAt).toBe(at);
    expect(m.status.containsSyntheticMedia).toBe(true);
    const none = buildVideoMeta('t', 'd', []) as { status: Record<string, unknown> };
    expect('publishAt' in none.status).toBe(false);
  });
});

describe('buildStatusUpdate — videos.update 는 상태를 통째로 덮어쓴다(순수)', () => {
  it('쓸 수 있는 현재 값은 옮기고, 읽기 전용·예약(publishAt)은 빼고, 아동용·AI 공개는 못박는다', () => {
    const cur = { uploadStatus: 'processed', privacyStatus: 'private', publishAt: '2026-10-01T03:30:00Z', license: 'youtube',
      embeddable: true, publicStatsViewable: true, madeForKids: false, selfDeclaredMadeForKids: false };
    const b = buildStatusUpdate('vid1', cur, 'public') as { id: string; status: Record<string, unknown> };
    expect(b.id).toBe('vid1');
    expect(b.status).toEqual({ license: 'youtube', embeddable: true, publicStatsViewable: true,
      privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });
  it('현재 상태를 못 읽었어도 필수 선언은 싣는다 — 빠지면 기본값으로 돌아가 AI 공개가 풀린다', () => {
    const b = buildStatusUpdate('vid1', undefined, 'private') as { status: Record<string, unknown> };
    expect(b.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });
});

describe('classifyThumb — 공개 썸네일 판정(순수)', () => {
  it('oEmbed 가 200 이 아니면 아직 공개 전(비공개는 401/403)', () => {
    expect(classifyThumb(403, 250_000, 25_000)).toBe('not_public');
    expect(classifyThumb(0, 0, 0)).toBe('not_public');
  });
  it('공개인데 1,097바이트 회색 자리표시면 썸네일 없음, 수십 KB 이상이면 정상(08-31·10-01 실측)', () => {
    expect(classifyThumb(200, 1097, 1097)).toBe('placeholder');
    expect(classifyThumb(200, 0, 0)).toBe('placeholder');
    expect(classifyThumb(200, 243_655, 23_435)).toBe('ok');
    expect(classifyThumb(200, 0, 23_435)).toBe('ok'); // oardefault 가 없어도 hqdefault 가 정상이면 정상
  });
});
