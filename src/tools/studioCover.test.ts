import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  studioCoverDue, studioCoverCheckDue, studioCoverStatus, parseAgentResult, buildStudioCoverPrompt, studioCoverArgs, sweepStudioCovers,
  STUDIO_COVER_MAX_ATTEMPTS, type StudioCoverDeps, type CoverStatus,
} from './studioCover';
import type { Shorts } from '../content/shorts';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
const short = (p: Partial<Shorts> = {}): Shorts => ({
  id: 'short_a', topic: '반항하는 아이', title: '반항하는 아이, 혼낸 다음 날', stage: 'ready',
  youtubeId: 'vid123', youtubeTs: min(60), createdTs: min(120), updatedTs: min(60), ...p,
});

describe('studioCoverDue — 스윕 대상 판정(순수)', () => {
  it('업로드 10분 이후 미지정 쇼츠는 대상', () => { expect(studioCoverDue(short(), NOW)).toBe(true); });
  it('유튜브 미업로드·이미 확인된 것은 제외', () => {
    expect(studioCoverDue(short({ youtubeId: undefined }), NOW)).toBe(false);
    expect(studioCoverDue(short({ ytStudioCoverTs: min(5) }), NOW)).toBe(false);
  });
  it('적용 시작 시각(YT_STUDIO_COVER_SINCE) 전 업로드는 건드리지 않는다 — 이식 2026-10-06', () => {
    expect(studioCoverDue(short({ youtubeTs: min(60) }), NOW, NOW - 30 * 60_000)).toBe(false);
    expect(studioCoverDue(short({ youtubeTs: min(20) }), NOW, NOW - 30 * 60_000)).toBe(true);
  });
  it('업로드 직후(10분 미만)는 처리 중이라 제외', () => {
    expect(studioCoverDue(short({ youtubeTs: min(9) }), NOW)).toBe(false);
    expect(studioCoverDue(short({ youtubeTs: min(10) }), NOW)).toBe(true);
  });
  it('재시도 간격(30분→2시간→6시간)과 최대 횟수를 지킨다', () => {
    expect(studioCoverDue(short({ ytStudioCoverAttempts: 1, ytStudioCoverAttemptTs: min(29) }), NOW)).toBe(false);
    expect(studioCoverDue(short({ ytStudioCoverAttempts: 1, ytStudioCoverAttemptTs: min(30) }), NOW)).toBe(true);
    expect(studioCoverDue(short({ ytStudioCoverAttempts: 2, ytStudioCoverAttemptTs: min(119) }), NOW)).toBe(false);
    expect(studioCoverDue(short({ ytStudioCoverAttempts: 3, ytStudioCoverAttemptTs: min(360) }), NOW)).toBe(true);
    expect(studioCoverDue(short({ ytStudioCoverAttempts: STUDIO_COVER_MAX_ATTEMPTS, ytStudioCoverAttemptTs: min(9999) }), NOW)).toBe(false);
  });
  it('공개 커버 확인은 시도 소진 뒤에도 계속(늦게 뜬 성공 기록)', () => {
    expect(studioCoverCheckDue(short({ ytStudioCoverAttempts: STUDIO_COVER_MAX_ATTEMPTS }), NOW)).toBe(true);
  });
  it('14일 넘은 업로드는 대상 아님(삭제·타 채널 영상 보호)', () => {
    expect(studioCoverCheckDue(short({ youtubeTs: min(14 * 24 * 60 + 1) }), NOW)).toBe(false);
    expect(studioCoverDue(short({ youtubeTs: min(14 * 24 * 60 + 1) }), NOW)).toBe(false);
  });
});

describe('studioCoverStatus — 공개 sardefault.jpg 로 판정', () => {
  const fake = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
  it('200=set · 404=unset · 그 외=unknown', async () => {
    expect(await studioCoverStatus('v', fake(200))).toBe('set');
    expect(await studioCoverStatus('v', fake(404))).toBe('unset');
    expect(await studioCoverStatus('v', fake(500))).toBe('unknown');
  });
  it('네트워크 오류는 unknown(시도 소모 안 함)', async () => {
    const boom = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await studioCoverStatus('v', boom)).toBe('unknown');
  });
  it('sardefault 경로를 조회한다', async () => {
    const f = fake(404);
    await studioCoverStatus('p6bSwgiKxII', f);
    expect((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe('https://i.ytimg.com/vi/p6bSwgiKxII/sardefault.jpg');
  });
});

describe('parseAgentResult — 에이전트 최종 JSON 추출(순수)', () => {
  it('성공·실패·잡음 섞인 출력', () => {
    expect(parseAgentResult('{"ok":true}')).toEqual({ ok: true });
    expect(parseAgentResult('done.\n{"ok":false,"reason":"채널 접근 불가"}')).toEqual({ ok: false, reason: '채널 접근 불가' });
    expect(parseAgentResult('{"ok":false,"reason":"x"}\n{"ok":true}')).toEqual({ ok: true }); // 마지막 것
  });
  it('JSON 이 없으면 실패', () => {
    expect(parseAgentResult('저장했습니다').ok).toBe(false);
    expect(parseAgentResult('').ok).toBe(false);
  });
});

describe('buildStudioCoverPrompt · studioCoverArgs — 헤드리스 안전장치', () => {
  const p = buildStudioCoverPrompt({ videoId: 'vid123', coverPath: '/x/shorts-cover.jpg', channelId: 'UCabc', deviceId: 'dev-1' });
  it('지정 브라우저·채널·영상·파일을 명시', () => {
    expect(p).toContain('deviceId "dev-1"');
    expect(p).toContain('https://studio.youtube.com/channel/UCabc/videos/short');
    expect(p).toContain('https://studio.youtube.com/video/vid123/edit');
    expect(p).toContain('/x/shorts-cover.jpg');
  });
  it('남은 탭 정리 후 새 탭에서만 작업·실패해도 탭 닫기', () => {
    expect(p).toMatch(/close each of them with tabs_close_mcp first/);
    expect(p).toMatch(/create a fresh tab with tabs_create_mcp/);
    expect(p).toMatch(/ALWAYS, also when you stop early/);
  });
  it('파일 선택창을 여는 클릭 금지·다른 필드 변경 금지·JSON 한 줄 응답', () => {
    expect(p).toMatch(/NEVER click the "파일 업로드" button/);
    expect(p).toMatch(/Do NOT change any other field/);
    expect(p).toMatch(/exactly one line of JSON/);
  });
  it('질문 도구 차단·크롬 도구만 허용·프롬프트는 stdin(위치 인자 없음)', () => {
    const a = studioCoverArgs('sonnet', '/x');
    expect(a).toContain('--chrome');
    expect(a[a.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
    const allowed = a[a.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed.every((t) => t === 'ToolSearch' || t.startsWith('mcp__claude-in-chrome__'))).toBe(true);
    expect(a.at(-2)).toBe('--output-format'); // 마지막은 옵션 값 — 프롬프트가 인자로 붙지 않는다
  });
});

describe('sweepStudioCovers — 스윕 흐름(의존성 주입)', () => {
  const setup = (items: Shorts[], statuses: CoverStatus[], agent = vi.fn(async () => ({ ok: true }))) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cover-'));
    const cover = path.join(dir, 'shorts-cover.jpg');
    fs.writeFileSync(cover, 'x');
    const store = new Map(items.map((s) => [s.id, { ...s }]));
    const status = vi.fn(async () => statuses.shift() ?? 'unset');
    const alert = vi.fn(async () => 1);
    const deps: StudioCoverDeps = {
      list: () => [...store.values()], update: (id, p) => { store.set(id, { ...store.get(id)!, ...p }); },
      dirFor: () => dir, deviceId: 'dev', channelId: 'UC', status, runAgent: agent,
      ensureCover: async () => cover, alert, now: () => NOW, sleep: async () => {},
    };
    return { deps, store, status, agent, alert };
  };

  it('이미 지정된 쇼츠는 에이전트 없이 확인만 기록', async () => {
    const t = setup([short()], ['set']);
    const r = await sweepStudioCovers(t.deps);
    expect(r.confirmed).toBe(1);
    expect(t.agent).not.toHaveBeenCalled();
    expect(t.store.get('short_a')!.ytStudioCoverTs).toBeTruthy();
  });

  it('미지정 → 에이전트 성공 → 공개 커버 확인되면 완료', async () => {
    const t = setup([short()], ['unset', 'unset', 'set']);
    const r = await sweepStudioCovers(t.deps);
    expect(r.uploaded).toBe(1);
    expect(t.agent).toHaveBeenCalledTimes(1);
    const s = t.store.get('short_a')!;
    expect(s.ytStudioCoverTs).toBeTruthy();
    expect(s.ytStudioCoverAttempts).toBe(1);
  });

  it('에이전트 실패는 시도·사유 기록 + 첫 실패에 알림 1회', async () => {
    const t = setup([short()], ['unset'], vi.fn(async () => ({ ok: false, reason: '채널 접근 불가' })));
    const r = await sweepStudioCovers(t.deps);
    expect(r.failed).toBe(1);
    const s = t.store.get('short_a')!;
    expect(s.ytStudioCoverTs).toBeUndefined();
    expect(s.ytStudioCoverAttempts).toBe(1);
    expect(s.ytStudioCoverError).toBe('채널 접근 불가');
    expect(t.alert).toHaveBeenCalledTimes(1);
  });

  it('저장 보고만 있고 공개 커버가 안 뜨면 완료로 치지 않되, 알림은 보내지 않는다', async () => {
    const t = setup([short()], ['unset', 'unset', 'unset', 'unset', 'unset']);
    const r = await sweepStudioCovers(t.deps);
    expect(r.failed).toBe(1);
    expect(t.store.get('short_a')!.ytStudioCoverError).toMatch(/공개 커버 미확인/);
    expect(t.alert).not.toHaveBeenCalled();
  });

  it('시도는 에이전트 실행 전에 기록된다(실행 중 재시작 대비)', async () => {
    let seen: number | undefined;
    const t = setup([short()], ['unset', 'set']);
    t.deps.runAgent = vi.fn(async () => { seen = t.store.get('short_a')!.ytStudioCoverAttempts; return { ok: true }; });
    await sweepStudioCovers(t.deps);
    expect(seen).toBe(1);
  });

  it('시도를 다 쓴 쇼츠도 공개 커버가 뜨면 완료로 기록(에이전트는 안 띄움)', async () => {
    const t = setup([short({ ytStudioCoverAttempts: STUDIO_COVER_MAX_ATTEMPTS, ytStudioCoverAttemptTs: min(5) })], ['set']);
    const r = await sweepStudioCovers(t.deps);
    expect(r.confirmed).toBe(1);
    expect(t.agent).not.toHaveBeenCalled();
    expect(t.store.get('short_a')!.ytStudioCoverTs).toBeTruthy();
  });

  it('시도를 다 쓴 쇼츠가 여전히 미지정이면 에이전트를 다시 띄우지 않는다', async () => {
    const t = setup([short({ ytStudioCoverAttempts: STUDIO_COVER_MAX_ATTEMPTS, ytStudioCoverAttemptTs: min(9999) })], ['unset']);
    await sweepStudioCovers(t.deps);
    expect(t.agent).not.toHaveBeenCalled();
    expect(t.alert).not.toHaveBeenCalled();
  });

  it('상태 불명이면 시도를 소모하지 않고 넘긴다', async () => {
    const t = setup([short()], ['unknown']);
    await sweepStudioCovers(t.deps);
    expect(t.agent).not.toHaveBeenCalled();
    expect(t.store.get('short_a')!.ytStudioCoverAttempts).toBeUndefined();
  });

  it('스윕당 에이전트는 1회만(나머지는 다음 주기)', async () => {
    const t = setup([short({ id: 's1', youtubeId: 'v1' }), short({ id: 's2', youtubeId: 'v2' })],
      ['unset', 'set', 'unset'], vi.fn(async () => ({ ok: true })));
    await sweepStudioCovers(t.deps);
    expect(t.agent).toHaveBeenCalledTimes(1);
  });

  it('마지막 시도 실패 시 포기 알림', async () => {
    const t = setup([short({ ytStudioCoverAttempts: STUDIO_COVER_MAX_ATTEMPTS - 1, ytStudioCoverAttemptTs: min(9999) })],
      ['unset'], vi.fn(async () => ({ ok: false, reason: '시간 초과' })));
    await sweepStudioCovers(t.deps);
    expect(t.alert).toHaveBeenCalledTimes(1);
    expect((t.alert.mock.calls[0] as unknown[])[0]).toMatch(/포기/);
  });
});
