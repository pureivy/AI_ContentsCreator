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
