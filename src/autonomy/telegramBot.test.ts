import { describe, it, expect } from 'vitest';
import { parseCallback, reviseEndpointFor, runAction, parseDirectiveCommand, describeDirective, type Senders } from './telegramBot';

/** 테스트용 발신부 — 실제 텔레그램을 치지 않는다. */
const stubSend = (log: Array<{ kind: 'photo' | 'html'; text: string; buttons?: unknown }> = []): { send: Senders; log: typeof log } => ({
  log,
  send: {
    photos: async (_f: string[], caption: string) => { log.push({ kind: 'photo', text: caption }); return true; },
    html: async (html: string, buttons?: unknown) => { log.push({ kind: 'html', text: html, buttons }); return true; },
  } as unknown as Senders,
});

describe('parseCallback', () => {
  it('발행 버튼 콜백 9종을 액션으로 파싱한다', () => {
    expect(parseCallback('bp:piece_d46aa8c450')).toEqual({ kind: 'naver_draft', id: 'piece_d46aa8c450' });
    expect(parseCallback('rv:piece_d46aa8c450')).toEqual({ kind: 'revise', id: 'piece_d46aa8c450' });
    expect(parseCallback('cp:card_e00fba6537')).toEqual({ kind: 'cardnews_publish', id: 'card_e00fba6537' });
    // QA 미해결 강행(사용자 확인) — cp 가 409(qa_unresolved)로 막힌 뒤 안내 메시지의 강행 버튼.
    expect(parseCallback('cf:card_e00fba6537')).toEqual({ kind: 'cardnews_force', id: 'card_e00fba6537' });
    expect(parseCallback('sy:short_2916818808')).toEqual({ kind: 'shorts_youtube', id: 'short_2916818808' });
    expect(parseCallback('sm:short_2916818808')).toEqual({ kind: 'shorts_meta', id: 'short_2916818808' });
    // 썸네일 한글 QA 미해결 2단계(2026-09-16) — 업로드가 409 로 막힌 뒤 안내 메시지의 버튼들.
    expect(parseCallback('yf:short_2916818808')).toEqual({ kind: 'shorts_youtube_force', id: 'short_2916818808' });
    expect(parseCallback('mf:short_2916818808')).toEqual({ kind: 'shorts_meta_force', id: 'short_2916818808' });
    expect(parseCallback('tr:short_2916818808')).toEqual({ kind: 'shorts_thumb_regen', id: 'short_2916818808' });
  });

  it('규격 밖 데이터는 null — 주입·오타 콜백을 액션으로 오인하지 않는다', () => {
    expect(parseCallback('')).toBeNull();
    expect(parseCallback('xx:piece_1')).toBeNull();
    expect(parseCallback('bp:')).toBeNull();
    expect(parseCallback('bp:has space')).toBeNull();
    expect(parseCallback('bp:semi;colon')).toBeNull();
    expect(parseCallback(`bp:${'a'.repeat(49)}`)).toBeNull(); // id 48자 초과
  });
});

describe('reviseEndpointFor — 수정요청 답장 대상 분기', () => {
  it('파생(card_/short_)은 자기 revise 라우트, 그 외는 블로그 piece 라우트', () => {
    expect(reviseEndpointFor('card_e00fba6537')).toEqual({ path: '/cardnews/card_e00fba6537/revise', label: '카드뉴스', derived: true });
    expect(reviseEndpointFor('short_2916818808')).toEqual({ path: '/shorts/short_2916818808/revise', label: '숏폼', derived: true });
    expect(reviseEndpointFor('piece_d46aa8c450')).toEqual({ path: '/pieces/piece_d46aa8c450/revise', label: '블로그', derived: false });
  });
});

describe('shorts_youtube 버튼 — 중복 완료 메시지 차단(2026-09-08)', () => {
  const run = async (json: Record<string, unknown>): Promise<string> =>
    runAction({ kind: 'shorts_youtube', id: 'short_1' }, async () => ({ ok: true, status: 200, json }));

  it('라우트가 알렸으면 빈 문자열 — 같은 말이 두 통 오면 안 된다', async () => {
    expect(await run({ ok: true, url: 'https://youtu.be/x', notified: true })).toBe('');
  });
  it('라우트가 안 알렸으면 버튼이 알린다 — 버튼을 눌렀는데 아무 응답이 없으면 안 된다', async () => {
    const out = await run({ ok: true, url: 'https://youtu.be/x', notified: false });
    expect(out).toContain('유튜브 비공개 업로드 완료');
    expect(out).toContain('https://youtu.be/x');
  });
  it('공개 발행(public_pending, 2026-10-01)이면 "자동 공개"로 알린다 — 스튜디오 공개 안내는 빼고', async () => {
    const out = await run({ ok: true, url: 'https://youtu.be/x', notified: false, public_pending: true });
    expect(out).toContain('자동 공개');
    expect(out).not.toContain('비공개');
    expect(out).not.toContain('스튜디오');
  });
  it('바로 공개(public_direct, 2026-10-05)면 "이미 공개"로 알린다 — 공개 예정·비공개라고 쓰지 않는다', async () => {
    const out = await run({ ok: true, url: 'https://youtu.be/x', notified: false, public_pending: false, public_direct: true });
    expect(out).toContain('이미 공개됨(커버 확인 중)');
    expect(out).not.toContain('공개 예정');
    expect(out).not.toContain('비공개');
    expect(out).not.toContain('스튜디오');
  });
  it('url 이 없으면 라우트도 안 알리므로 버튼이 알린다', async () => {
    expect(await run({ ok: true, notified: false })).toContain('업로드 완료');
  });
});

describe('parseDirectiveCommand — 텔레그램 자율런 지시 명령(순수, 2026-09-10)', () => {
  it('설정 — "자율런 지시: …" / 접두 생략 / 편수 상한', () => {
    expect(parseDirectiveCommand('자율런 지시: 보관소의 수종별 수확 후 전정 및 거름주는 방법')).toEqual({ kind: 'set', text: '보관소의 수종별 수확 후 전정 및 거름주는 방법' });
    expect(parseDirectiveCommand('지시：감나무만')).toEqual({ kind: 'set', text: '감나무만' });
    expect(parseDirectiveCommand('지시 5편: 가을 심기')).toEqual({ kind: 'set', text: '가을 심기', maxPieces: 5 });
    expect(parseDirectiveCommand('오토런 지시 3 편 : 전정')).toEqual({ kind: 'set', text: '전정', maxPieces: 3 });
  });
  it('끄기·켜기·상태·삭제', () => {
    expect(parseDirectiveCommand('지시 끄기')).toEqual({ kind: 'off' });
    expect(parseDirectiveCommand('자율런 지시 해제')).toEqual({ kind: 'off' });
    expect(parseDirectiveCommand('지시 켜기')).toEqual({ kind: 'on' });
    expect(parseDirectiveCommand('지시')).toEqual({ kind: 'show' });
    expect(parseDirectiveCommand('지시 상태')).toEqual({ kind: 'show' });
    expect(parseDirectiveCommand('지시 삭제')).toEqual({ kind: 'clear' });
  });
  it('일반 문장·수정 지시·빈 문구는 명령이 아니다', () => {
    expect(parseDirectiveCommand('지시사항을 정리한 글')).toBeNull();
    expect(parseDirectiveCommand('자율런 실행')).toBeNull();
    expect(parseDirectiveCommand('지시:   ')).toBeNull();
    expect(parseDirectiveCommand('오늘 감나무 글 써줘')).toBeNull();
  });
  it('describeDirective — 없음/켜짐/꺼짐(사유)', () => {
    expect(describeDirective(null)).toContain('지시 없음');
    expect(describeDirective({ text: 'A', on: true, made: 1, maxPieces: 3 })).toContain('1/3편');
    const off = describeDirective({ text: 'A', on: false, made: 3, maxPieces: 3, lastResult: '편수 상한 3편 도달' });
    expect(off).toContain('꺼짐'); expect(off).toContain('상한'); expect(off).toContain('다시 켜기');
  });
});

// 썸네일 한글 QA 미해결(409) — 종전엔 업로드 버튼이 막히기만 하고 앞으로 갈 길이 없었다.
// 수정요청은 대본만 고쳐 표식이 그대로 남아, 눌러도 같은 경고가 되돌아왔다(사용자 제보 2026-09-16).
describe('썸네일 QA 미해결 — 확인 후 강행 2단계', () => {
  const qa409 = { ok: false, status: 409, json: { error: '썸네일 한글 QA가 오타 가능성을 미해결로 남겼습니다', thumb_qa_unresolved: true } };
  it('유튜브는 안내를 직접 보내고 빈 문자열 — 강행·재생성 두 버튼을 함께 준다', async () => {
    const s = stubSend();
    expect(await runAction({ kind: 'shorts_youtube', id: 'short_1' }, async () => qa409, s.send)).toBe('');
    const guide = s.log.find((x) => x.kind === 'html')!;
    expect(guide.text).toContain('썸네일 한글 QA 미해결');
    expect(guide.text).toContain('수정요청은 대본만 고치므로'); // 사용자가 헛수고하지 않게 명시
    expect(JSON.stringify(guide.buttons)).toContain('tr:short_1');
    expect(JSON.stringify(guide.buttons)).toContain('yf:short_1');
  });
  it('릴스는 같은 안내에 릴스 강행 버튼', async () => {
    const s = stubSend();
    expect(await runAction({ kind: 'shorts_meta', id: 'short_1' }, async () => qa409, s.send)).toBe('');
    expect(JSON.stringify(s.log.find((x) => x.kind === 'html')!.buttons)).toContain('mf:short_1');
  });
  it('QA 가 아닌 409·다른 실패는 종전대로 오류 문구', async () => {
    const other = { ok: false, status: 409, json: { error: '이미 업로드됨' } };
    const s = stubSend();
    expect(await runAction({ kind: 'shorts_youtube', id: 'short_1' }, async () => other, s.send)).toContain('이미 업로드됨');
    expect(await runAction({ kind: 'shorts_meta', id: 'short_1' }, async () => other, s.send)).toContain('이미 업로드됨');
    expect(s.log).toEqual([]);
  });
  it('강행 버튼은 force 를 실어 같은 발행 라우트를 부른다', async () => {
    const seen: Array<{ p: string; b: unknown }> = [];
    const call = async (p: string, b?: unknown) => { seen.push({ p, b }); return { ok: true, status: 200, json: { notified: false, url: 'https://youtu.be/x' } }; };
    await runAction({ kind: 'shorts_youtube_force', id: 'short_1' }, call);
    await runAction({ kind: 'shorts_meta_force', id: 'short_1' }, call);
    expect(seen[0]).toEqual({ p: '/shorts/short_1/youtube', b: { force: true } });
    expect(seen[1]).toEqual({ p: '/shorts/short_1/meta', b: { force: true } });
  });
  it('썸네일 다시 만들기는 재생성 라우트를 부른다', async () => {
    const seen: string[] = [];
    const s = stubSend();
    await runAction({ kind: 'shorts_thumb_regen', id: 'short_1' }, async (p) => { seen.push(p); return { ok: true, status: 200, json: { ok: true } }; }, s.send);
    expect(seen).toEqual(['/shorts/short_1/thumbnail/regenerate']);
    expect(JSON.stringify(s.log.find((x) => x.kind === 'html')!.buttons)).toContain('sy:short_1'); // 이어서 발행
  });
  it('재생성이 실패하면 오류 문구', async () => {
    const out = await runAction({ kind: 'shorts_thumb_regen', id: 'short_1' }, async () => ({ ok: false, status: 502, json: { error: '썸네일 생성 실패' } }), stubSend().send);
    expect(out).toContain('썸네일 생성 실패');
  });
});

// 네이버 클립(2026-10-02) — 유튜브용 편을 클립에도. 업로드는 202 로 시작만 하고 결과는 서버가 알린다.
describe('네이버 클립 버튼', () => {
  it('nc/nf/nk 콜백을 클립 액션으로 읽는다', () => {
    expect(parseCallback('nc:short_fe6da81caf')).toEqual({ kind: 'shorts_clip', id: 'short_fe6da81caf' });
    expect(parseCallback('nf:short_fe6da81caf')).toEqual({ kind: 'shorts_clip_force', id: 'short_fe6da81caf' });
    expect(parseCallback('nk:short_fe6da81caf')).toEqual({ kind: 'shorts_clip_check', id: 'short_fe6da81caf' });
  });
  it('시작만 알리고, 강행은 force 를 싣는다', async () => {
    const seen: Array<{ p: string; b: unknown }> = [];
    const call = async (p: string, b?: unknown) => { seen.push({ p, b }); return { ok: true, status: 202, json: { ok: true, started: true } }; };
    const out = await runAction({ kind: 'shorts_clip', id: 'short_1' }, call, stubSend().send);
    expect(out).toContain('업로드 시작');
    expect(seen[0]!.p).toBe('/shorts/short_1/naver-clip');
    await runAction({ kind: 'shorts_clip_force', id: 'short_1' }, call, stubSend().send);
    expect(seen[1]!.b).toEqual({ force: true });
  });
  it('썸네일 QA 미해결이면 클립 강행 버튼(nf)을 준다', async () => {
    const s = stubSend();
    const qa409 = { ok: false, status: 409, json: { error: 'QA', thumb_qa_unresolved: true } };
    expect(await runAction({ kind: 'shorts_clip', id: 'short_1' }, async () => qa409, s.send)).toBe('');
    expect(JSON.stringify(s.log.find((x) => x.kind === 'html')!.buttons)).toContain('nf:short_1');
  });
  it('등록 뒤 미확인으로 막히면 확인 버튼(nk)을 준다 — 다시 올리지 않게', async () => {
    const s = stubSend();
    const r409 = { ok: false, status: 409, json: { error: '공개 확인을 못 한 편', submitted: true } };
    expect(await runAction({ kind: 'shorts_clip', id: 'short_1' }, async () => r409, s.send)).toBe('');
    expect(JSON.stringify(s.log[0]!.buttons)).toContain('nk:short_1');
  });
  it('확인: 공개돼 있으면 기록, 없으면 다시 올리기 버튼', async () => {
    const seen: unknown[] = [];
    const found = await runAction({ kind: 'shorts_clip_check', id: 'short_1' }, async (_p, b) => { seen.push(b); return { ok: true, status: 200, json: { status: 'RECOVERED', url: 'https://clip.naver.com/@bionditree' } }; }, stubSend().send);
    expect(seen[0]).toEqual({ check: true });
    expect(found).toContain('기록했습니다');
    const s = stubSend();
    expect(await runAction({ kind: 'shorts_clip_check', id: 'short_1' }, async () => ({ ok: true, status: 200, json: { status: 'NOT_FOUND' } }), s.send)).toBe('');
    expect(JSON.stringify(s.log[0]!.buttons)).toContain('nc:short_1');
  });
  it('확인: 아직 처리 중(초안으로 보임)이면 실패가 아니라 다시 확인 버튼', async () => {
    const s = stubSend();
    const pending = { ok: false, status: 409, json: { status: 'STILL_DRAFT', error: '등록한 영상이 아직 초안으로 보입니다', submitted: true } };
    expect(await runAction({ kind: 'shorts_clip_check', id: 'short_1' }, async () => pending, s.send)).toBe('');
    expect(s.log[0]!.text).toContain('아직 초안');
    expect(JSON.stringify(s.log[0]!.buttons)).toContain('nk:short_1');
  });
  it('실패는 사유를 그대로 알린다', async () => {
    const out = await runAction({ kind: 'shorts_clip', id: 'short_1' }, async () => ({ ok: false, status: 409, json: { error: '원본 영상(final.mp4)이 정리돼 없습니다' } }), stubSend().send);
    expect(out).toContain('네이버 클립 업로드 실패');
    expect(out).toContain('final.mp4');
  });
});

// 2026-10-12 사장님 확정 — 숏폼 사실 검증 보류도 카드뉴스 오타 QA처럼 '확인 후 강행' 2단계.
describe('사실 검증 보류 — 확인 후 강행 2단계', () => {
  const hold409 = { ok: false, status: 409, json: { error: '사실 검증 보류 1건', fact_hold: ['겨울 넘기면 살았다고 봐요.'] } };
  it('콜백 yh·mh·nh 를 채널별 강행으로 읽는다', () => {
    expect(parseCallback('yh:short_1')).toEqual({ kind: 'shorts_fact_force', id: 'short_1', ch: 'youtube' });
    expect(parseCallback('mh:short_1')).toEqual({ kind: 'shorts_fact_force', id: 'short_1', ch: 'instagram' });
    expect(parseCallback('nh:short_1')).toEqual({ kind: 'shorts_fact_force', id: 'short_1', ch: 'clip' });
  });
  it('첫 버튼은 문장을 되보여 주고 수정요청·강행 두 버튼을 준다(세 채널)', async () => {
    for (const [kind, op] of [['shorts_youtube', 'yh'], ['shorts_meta', 'mh'], ['shorts_clip', 'nh']] as const) {
      const s = stubSend();
      expect(await runAction({ kind, id: 'short_1' }, async () => hold409, s.send)).toBe('');
      const g = s.log.find((x) => x.kind === 'html')!;
      expect(g.text).toContain('사실 검증 보류 1건');
      expect(g.text).toContain('겨울 넘기면 살았다고 봐요.');
      expect(JSON.stringify(g.buttons)).toContain('rv:short_1');
      expect(JSON.stringify(g.buttons)).toContain(`${op}:short_1`);
    }
  });
  it('썸네일 강행(yf) 뒤에 보류가 남으면 이어서 보류 안내', async () => {
    const s = stubSend();
    expect(await runAction({ kind: 'shorts_youtube_force', id: 'short_1' }, async () => hold409, s.send)).toBe('');
    expect(JSON.stringify(s.log[0]!.buttons)).toContain('yh:short_1');
  });
  it('강행은 force·forceFact 를 함께 실어 같은 라우트를 부른다', async () => {
    const seen: Array<[string, unknown]> = [];
    const call = async (p: string, b?: unknown) => { seen.push([p, b]); return { ok: true, status: 200, json: { igPermalink: 'https://instagram.com/reel/x' } }; };
    expect(await runAction({ kind: 'shorts_fact_force', id: 'short_1', ch: 'instagram' }, call, stubSend().send)).toContain('사실 검증 확인 강행');
    expect(seen[0]).toEqual(['/shorts/short_1/meta', { force: true, forceFact: true }]);
    await runAction({ kind: 'shorts_fact_force', id: 'short_1', ch: 'clip' }, call, stubSend().send);
    expect(seen[1]![0]).toBe('/shorts/short_1/naver-clip');
  });
});

// 2026-10-22 롱폼 — 썸네일 사진 알림의 버튼(ly·lt·lf). 라우트는 error 에 코드, message 에 한국어를 싣는다.
describe('롱폼 버튼(ly·lt·lf)', () => {
  it('콜백 파싱', () => {
    expect(parseCallback('ly:long_pilot20261019')).toEqual({ kind: 'longform_youtube', id: 'long_pilot20261019' });
    expect(parseCallback('lf:long_pilot20261019')).toEqual({ kind: 'longform_youtube_force', id: 'long_pilot20261019' });
    expect(parseCallback('lt:long_pilot20261019')).toEqual({ kind: 'longform_thumb_regen', id: 'long_pilot20261019' });
    expect(parseCallback('lx:long_pilot20261019')).toBeNull();
  });
  it('ly — 202 면 업로드 시작 안내(결과는 서버가 따로 알린다)', async () => {
    const seen: Array<[string, unknown]> = [];
    const out = await runAction({ kind: 'longform_youtube', id: 'long_t1' }, async (p, b) => { seen.push([p, b]); return { ok: true, status: 202, json: { ok: true, started: true } }; }, stubSend().send);
    expect(out).toContain('업로드 시작');
    expect(out).toContain('끝나면 알려 드립니다');
    expect(seen[0]).toEqual(['/longform/long_t1/youtube', {}]);
  });
  it('ly — 썸네일 QA 미해결이면 다시 만들기·그대로 발행(lf) 버튼 안내', async () => {
    const s = stubSend();
    const r409 = { ok: false, status: 409, json: { error: 'thumb_qa_unresolved', message: '썸네일 한글 QA 미해결' } };
    expect(await runAction({ kind: 'longform_youtube', id: 'long_t1' }, async () => r409, s.send)).toBe('');
    const btn = JSON.stringify(s.log.at(-1)!.buttons);
    expect(btn).toContain('lf:long_t1');
    expect(btn).toContain('lt:long_t1');
  });
  it('lf — force 를 싣고, 이미 올림·업로드 중은 그에 맞게 답한다', async () => {
    const seen: unknown[] = [];
    const out = await runAction({ kind: 'longform_youtube_force', id: 'long_t1' }, async (_p, b) => { seen.push(b); return { ok: true, status: 202, json: { started: true } }; }, stubSend().send);
    expect(seen[0]).toEqual({ force: true });
    expect(out).toContain('강행');
    const already = { ok: false, status: 409, json: { error: 'already_uploaded', message: '이미 업로드됨', url: 'https://www.youtube.com/watch?v=abc' } };
    expect(await runAction({ kind: 'longform_youtube', id: 'long_t1' }, async () => already, stubSend().send)).toContain('watch?v=abc');
    const busy = { ok: false, status: 409, json: { error: 'in_flight', message: '이미 업로드 중' } };
    expect(await runAction({ kind: 'longform_youtube', id: 'long_t1' }, async () => busy, stubSend().send)).toContain('이미 업로드 중');
  });
  it('기타 실패는 한국어 message 를 보인다(코드가 아니라)', async () => {
    const r = { ok: false, status: 409, json: { error: 'not_ready', message: '아직 완성되지 않았습니다' } };
    const out = await runAction({ kind: 'longform_youtube', id: 'long_t1' }, async () => r, stubSend().send);
    expect(out).toContain('아직 완성되지 않았습니다');
    expect(out).not.toContain('not_ready');
  });
  it('lt — 재생성 뒤 검토 알림을 다시 보내면 빈 문자열, 못 보내면 완료 문구', async () => {
    const s = stubSend();
    const resent: string[] = [];
    const send = { ...s.send, longformReady: async (id: string) => { resent.push(id); return true; } };
    const seen: Array<[string, number | undefined]> = [];
    const call = async (p: string, _b?: unknown, t?: number) => { seen.push([p, t]); return { ok: true, status: 200, json: { ok: true, thumbState: 'ok' } }; };
    expect(await runAction({ kind: 'longform_thumb_regen', id: 'long_t1' }, call, send)).toBe('');
    expect(resent).toEqual(['long_t1']);
    expect(seen[0]![0]).toBe('/longform/long_t1/thumbnail/regenerate');
    expect(seen[0]![1]).toBeGreaterThanOrEqual(5 * 60_000);
    const qa = await runAction({ kind: 'longform_thumb_regen', id: 'long_t1' }, async () => ({ ok: true, status: 200, json: { thumbState: 'qa_failed' } }), stubSend().send);
    expect(qa).toContain('오타 의심');
    const fail = await runAction({ kind: 'longform_thumb_regen', id: 'long_t1' }, async () => ({ ok: false, status: 502, json: { error: 'thumb_failed', message: '썸네일 생성 실패' } }), stubSend().send);
    expect(fail).toContain('썸네일 생성 실패');
  });
});
