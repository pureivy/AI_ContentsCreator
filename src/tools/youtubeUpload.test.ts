import { describe, it, expect } from 'vitest';
import { buildVideoMeta, buildMultipartBody, extractVideoId, buildStatusUpdate, classifyThumb, majorityChannel, decideChannelConnect, verifyPublicCover, coverNeedsAlert, type CoverState } from './youtubeUpload';
import { parseYtCoverOutput } from './blog_skills';

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
    expect(classifyThumb(403, 250_000)).toBe('not_public');
    expect(classifyThumb(0, 0)).toBe('not_public');
  });
  it('공개인데 1,097바이트 회색 자리표시면 썸네일 없음, 수십 KB 이상이면 정상(08-31·10-01 실측)', () => {
    expect(classifyThumb(200, 1097)).toBe('placeholder');
    expect(classifyThumb(200, 0)).toBe('placeholder');
    expect(classifyThumb(200, 243_655)).toBe('ok');
  });
  it('세로(oardefault)가 자리표시면 가로(hqdefault)가 멀쩡해도 썸네일 없음 — 쇼츠 화면은 세로를 쓴다(2026-10-02 실사고)', () => {
    // tDK8E6KxQQw: oardefault 1,097 · hqdefault 18,433(디자인 썸네일) — 쇼츠 피드엔 중간 프레임이 나왔다.
    expect(classifyThumb(200, 1097)).toBe('placeholder');
    expect(classifyThumb(200, 0)).toBe('placeholder');
  });
});

// 채널 연결 보호 장치(2026-10-01 실사고) — 재연결 때 계정을 잘못 골라 Acoustic AI Singer 로 두 번 연결됐다.
// 완료 화면이 똑같아 티가 안 났고, 그대로 업로드했으면 엉뚱한 채널에 올라갔다.
describe('majorityChannel — 업로드 이력의 채널(순수)', () => {
  it('가장 많이 나온 채널, 빈 목록이면 null', () => {
    const v = (id: string, t: string) => ({ snippet: { channelId: id, channelTitle: t } });
    expect(majorityChannel([v('UC_B', '비온디트리'), v('UC_B', '비온디트리'), v('UC_X', '다른채널')])).toEqual({ id: 'UC_B', title: '비온디트리' });
    expect(majorityChannel([])).toBeNull();
    expect(majorityChannel([{ snippet: {} }])).toBeNull();
  });
});

describe('decideChannelConnect — 원래 채널과 다르면 저장하지 않는다(순수)', () => {
  const B = { id: 'UC_B', title: '비온디트리' };
  const X = { id: 'UC_X', title: 'Acoustic AI Singer' };
  it('같은 채널이면 저장', () => {
    expect(decideChannelConnect(B, B, false).save).toBe(true);
  });
  it('다른 채널이면 거절하고 두 채널 이름을 모두 알려 준다', () => {
    const d = decideChannelConnect(X, B, false);
    expect(d.save).toBe(false);
    expect(d.message).toContain('Acoustic AI Singer');
    expect(d.message).toContain('비온디트리');
  });
  it('채널을 일부러 바꿀 때(change_channel)는 허용', () => {
    expect(decideChannelConnect(X, B, true).save).toBe(true);
  });
  it('원래 채널을 모르면(첫 연결·업로드 이력 없음) 저장하고 채널 이름을 보여 준다', () => {
    const d = decideChannelConnect(B, null, false);
    expect(d.save).toBe(true);
    expect(d.message).toContain('비온디트리');
  });
});

describe('공개 직행 업로드 — 쇼츠 커버가 첫 장면(2026-10-05)', () => {
  it('privacy=public 이면 공개로 싣고 예약 공개는 뺀다(공개 업로드에 publishAt 은 거절된다)', () => {
    const m = buildVideoMeta('t', 'd', [], undefined, '2026-10-05T10:00:00Z', 'public') as { status: Record<string, unknown> };
    expect(m.status.privacyStatus).toBe('public');
    expect(m.status.publishAt).toBeUndefined();
  });
  it('기본은 종전 그대로 비공개 + 예약 공개', () => {
    const m = buildVideoMeta('t', 'd', [], undefined, '2026-10-05T10:00:00Z') as { status: Record<string, unknown> };
    expect(m.status.privacyStatus).toBe('private');
    expect(m.status.publishAt).toBe('2026-10-05T10:00:00Z');
  });
  const seq = (states: CoverState[]) => { let i = 0; return async () => ({ state: states[Math.min(i++, states.length - 1)]! }); };
  it('첫 장면이 확인되면 바로 끝', async () => {
    const o = await verifyPublicCover({ videoId: 'x', check: seq(['missing', 'first']), pollMs: 0, tries: 5 });
    expect(o.state).toBe('first');
  });
  it('중간 장면은 두 번 연속이어야 확정 — 처리 직후 잠깐 걸린 프레임으로 오경보하지 않는다', async () => {
    expect((await verifyPublicCover({ videoId: 'x', check: seq(['middle', 'first']), pollMs: 0, tries: 5 })).state).toBe('first');
    const o = await verifyPublicCover({ videoId: 'x', check: seq(['middle', 'middle']), pollMs: 0, tries: 5 });
    expect(o.state).toBe('middle');
    expect(o.note).toContain('맨 앞 프레임');
  });
  it('끝까지 커버가 없으면 missing, 조회 실패는 unknown', async () => {
    expect((await verifyPublicCover({ videoId: 'x', check: seq(['missing']), pollMs: 0, tries: 3 })).state).toBe('missing');
    const boom = async (): Promise<{ state: CoverState }> => { throw new Error('net'); };
    expect((await verifyPublicCover({ videoId: 'x', check: boom, pollMs: 0, tries: 2 })).state).toBe('unknown');
  });
  // 10-06 정정 — 판정은 쇼츠 탭 커버(oardefault) 하나. sardefault 는 보지 않는다(check 가 oardefault 만 넘긴다).
  it('중간 장면이 한 번 보였다가 첫 장면으로 바뀌면 first', async () => {
    const o = await verifyPublicCover({ videoId: 'x', pollMs: 0, tries: 6, check: seq(['missing', 'middle', 'first']) });
    expect(o.state).toBe('first');
  });
  it('끝까지 비어 있으면 missing — 쇼츠 탭엔 중간 장면이 보이므로 알림 문구가 맨 앞 프레임 지정을 안내한다', async () => {
    const o = await verifyPublicCover({ videoId: 'x', check: seq(['missing']), pollMs: 0, tries: 3 });
    expect(o.state).toBe('missing');
    expect(o.note).toContain('맨 앞 프레임');
    expect(coverNeedsAlert(o.state)).toBe(true);
  });
  it('알림은 중간 장면·없음만 — unknown(파이썬 없음 등)은 로그만', () => {
    expect(coverNeedsAlert('middle')).toBe(true);
    expect(coverNeedsAlert('missing')).toBe(true);
    expect(coverNeedsAlert('unknown')).toBe(false);
    expect(coverNeedsAlert('first')).toBe(false);
  });
  it('yt_cover_check.py 출력 파싱 — 결과 줄이 없거나 깨지면 unknown', () => {
    expect(parseYtCoverOutput('RESULT_JSON: {"state":"first","cover":"sardefault","simFirst":0.93,"simMid":-0.07}'))
      .toEqual({ state: 'first', cover: 'sardefault', simFirst: 0.93, simMid: -0.07 });
    expect(parseYtCoverOutput('경고\nRESULT_JSON: {"state":"middle"}').state).toBe('middle');
    expect(parseYtCoverOutput('').state).toBe('unknown');
    expect(parseYtCoverOutput('RESULT_JSON: {broken').state).toBe('unknown');
    expect(parseYtCoverOutput('RESULT_JSON: {"state":"weird"}').state).toBe('unknown');
  });
});
