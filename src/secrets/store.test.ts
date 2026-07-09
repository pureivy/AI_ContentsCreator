import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvText, upsertEnvText, maskSecret, getYoutubeAccount, setYoutubeToken, parseMetaTokens } from './store';

// .env 가 '단일 값 저장소'가 되면서 UI 편집이 파일을 직접 고쳐 쓴다 — 손으로 관리하던
// 주석/빈 줄/모르는 키를 절대 훼손하지 않아야 한다(실 .env 엔 커밋 금지 실키가 있음).

describe('parseEnvText — .env 텍스트 → 값 맵', () => {
  it('기본 KEY=value, 공백/따옴표 허용', () => {
    const v = parseEnvText('A=1\nB = two \nC="with space"\nD=\'single\'\n');
    expect(v).toEqual({ A: '1', B: 'two', C: 'with space', D: 'single' });
  });
  it('주석·빈 줄·비정형 라인 무시, 주석 처리된 키는 값 아님', () => {
    const v = parseEnvText('# NOTE\n\n#SECRET_KEY=hidden\nREAL=x\nnot a line\n');
    expect(v).toEqual({ REAL: 'x' });
  });
  it('중복 키는 마지막 값(loadEnvFile 과 동일 동작)', () => {
    expect(parseEnvText('K=old\nK=new\n').K).toBe('new');
  });
  it('export 접두 허용', () => {
    expect(parseEnvText('export TOK=abc\n').TOK).toBe('abc');
  });
});

describe('upsertEnvText — 키 교체/추가/삭제, 나머지 라인 보존', () => {
  const BASE = '# 결제 키 — 절대 커밋 금지\nAAA=1\n\n#COMMENTED=out\nBBB="b b"\n';
  it('기존 키 교체 — 주석·빈 줄·다른 키 그대로', () => {
    const out = upsertEnvText(BASE, 'AAA', '99');
    expect(out).toBe('# 결제 키 — 절대 커밋 금지\nAAA=99\n\n#COMMENTED=out\nBBB="b b"\n');
  });
  it('새 키는 끝에 추가(개행 정리)', () => {
    const out = upsertEnvText(BASE, 'NEW_KEY', 'v');
    expect(out.endsWith('BBB="b b"\nNEW_KEY=v\n')).toBe(true);
    expect(parseEnvText(out).NEW_KEY).toBe('v');
  });
  it('삭제(undefined) — 해당 라인만 사라짐, 주석 처리된 동명 라인은 보존', () => {
    const out = upsertEnvText('#K=keep\nK=drop\nOTHER=1\n', 'K', undefined);
    expect(out).toBe('#K=keep\nOTHER=1\n');
  });
  it('중복 라인은 하나로 정리', () => {
    const out = upsertEnvText('K=a\nK=b\n', 'K', 'c');
    expect(out).toBe('K=c\n');
  });
  it('공백·# 포함 값은 따옴표로 감싸고 파싱 시 원복(라운드트립)', () => {
    for (const v of ['has space', 'ha#sh', 'quo"te', 'back\\slash', 'plain-token_123']) {
      const out = upsertEnvText('', 'K', v);
      expect(parseEnvText(out).K).toBe(v);
    }
  });
  it('빈 파일에서 추가', () => {
    expect(upsertEnvText('', 'A', '1')).toBe('A=1\n');
  });
});

describe('maskSecret — 항상 마스킹', () => {
  it('짧으면 전부, 길면 앞4·뒤4', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abcd')).toBe('••••');
    expect(maskSecret('sk-test-1234567890')).toBe('sk-t••••7890');
  });
});

// 브랜드별 네이버 계정 — 범용('')은 평면 키, 브랜드는 NAVER_ACCOUNTS JSON blob, 폴백 없음(격리).
// get/setNaverAccount 는 .env(ENV_FILE=GEPA_ENV_FILE)에 read/write 하므로 임시 파일을 가리키게 한 뒤
// vi.resetModules + 동적 import 로 실제 파일 왕복을 검증한다(모듈 로드 시 ENV_FILE 고정 특성 우회).
describe('네이버 브랜드별 계정 — 격리·라운드트립', () => {
  const NAVER_ENV = ['NAVER_ACCOUNTS', 'NAVER_BLOG_ID', 'NAVER_LOGIN_ID', 'NAVER_LOGIN_PW'];
  let tmpEnv: string;
  let mod: typeof import('./store');
  beforeEach(async () => {
    tmpEnv = path.join(os.tmpdir(), 'naver-acct-store-test.env');
    fs.writeFileSync(tmpEnv, '', { mode: 0o600 });
    process.env.GEPA_ENV_FILE = tmpEnv;
    for (const k of NAVER_ENV) delete process.env[k]; // 이전 테스트의 process.env 미러링 잔재 제거
    vi.resetModules();
    mod = await import('./store');
  });
  afterEach(() => {
    try { fs.rmSync(tmpEnv); } catch { /* 이미 없음 */ }
    delete process.env.GEPA_ENV_FILE;
    for (const k of NAVER_ENV) delete process.env[k];
  });

  it('범용(빈 슬러그)은 평면 키에 저장·조회, blob 미사용', () => {
    mod.setNaverAccount('', { blogId: 'myblog', loginId: 'me', loginPw: 'secret' });
    const txt = fs.readFileSync(tmpEnv, 'utf-8');
    expect(txt).toMatch(/^NAVER_BLOG_ID=myblog$/m);
    expect(txt).not.toContain('NAVER_ACCOUNTS');
    expect(mod.getNaverAccount('')).toEqual({ blogId: 'myblog', loginId: 'me', loginPw: 'secret' });
  });

  it('브랜드는 JSON blob 에 슬러그별 저장, 평면 키·타 브랜드와 섞이지 않음', () => {
    mod.setNaverAccount('cafe-a', { blogId: 'blogA', loginId: 'idA' });
    mod.setNaverAccount('cafe-b', { blogId: 'blogB' });
    expect(mod.getNaverAccount('cafe-a')).toEqual({ blogId: 'blogA', loginId: 'idA', loginPw: '' });
    expect(mod.getNaverAccount('cafe-b')).toEqual({ blogId: 'blogB', loginId: '', loginPw: '' });
    const txt = fs.readFileSync(tmpEnv, 'utf-8');
    expect(txt).toContain('NAVER_ACCOUNTS=');
    expect(txt).not.toMatch(/^NAVER_BLOG_ID=/m); // 브랜드는 평면 키를 건드리지 않음
  });

  it('브랜드는 범용 평면 키로 폴백하지 않는다(미설정 브랜드 = 빈 계정)', () => {
    mod.setNaverAccount('', { blogId: 'globalblog' });
    expect(mod.getNaverAccount('unset-brand')).toEqual({ blogId: '', loginId: '', loginPw: '' });
  });

  it('부분 갱신은 기존 필드 보존, 빈 값은 해당 필드 삭제', () => {
    mod.setNaverAccount('cafe-a', { blogId: 'b1', loginId: 'i1', loginPw: 'p1' });
    mod.setNaverAccount('cafe-a', { loginPw: 'p2' });
    expect(mod.getNaverAccount('cafe-a')).toEqual({ blogId: 'b1', loginId: 'i1', loginPw: 'p2' });
    mod.setNaverAccount('cafe-a', { loginId: '' });
    expect(mod.getNaverAccount('cafe-a')).toEqual({ blogId: 'b1', loginId: '', loginPw: 'p2' });
  });

  it('naverAccountView — blogId 평문, 로그인 마스킹·설정여부', () => {
    mod.setNaverAccount('cafe-a', { blogId: 'openblog', loginId: 'longloginid', loginPw: 'pw' });
    const v = mod.naverAccountView('cafe-a');
    expect(v.blogId).toBe('openblog');
    expect(v.loginIdSet).toBe(true);
    expect(v.loginPwSet).toBe(true);
    expect(v.loginIdMasked).not.toBe('longloginid');
  });
});

// 브랜드별 유튜브 채널 토큰 — NAVER_ACCOUNTS 와 동일 패턴(JSON blob, 폴백 없음, 범용('') 도 blob).
// get/setYoutubeToken 은 .env(ENV_FILE=GEPA_ENV_FILE)에 read/write 하므로 임시 파일을 가리키게 한 뒤
// vi.resetModules + 동적 import 로 실제 파일 왕복을 검증한다(모듈 로드 시 ENV_FILE 고정 특성 우회).
describe('유튜브 브랜드별 채널 토큰 — 격리·라운드트립(네이버 미러)', () => {
  const YT_ENV = ['YOUTUBE_TOKENS'];
  let tmpEnv: string;
  let mod: typeof import('./store');
  beforeEach(async () => {
    tmpEnv = path.join(os.tmpdir(), 'youtube-token-store-test.env');
    fs.writeFileSync(tmpEnv, '', { mode: 0o600 });
    process.env.GEPA_ENV_FILE = tmpEnv;
    for (const k of YT_ENV) delete process.env[k]; // 이전 테스트의 process.env 미러링 잔재 제거
    vi.resetModules();
    mod = await import('./store');
  });
  afterEach(() => {
    try { fs.rmSync(tmpEnv); } catch { /* 이미 없음 */ }
    delete process.env.GEPA_ENV_FILE;
    for (const k of YT_ENV) delete process.env[k];
  });

  it('미연결 브랜드는 빈 토큰 반환(폴백 없음)', () => {
    expect(mod.getYoutubeAccount('unset-brand')).toEqual({ refreshToken: '' });
  });

  it('저장 후 라운드트립 — 브랜드 A 저장 → A로 읽힘', () => {
    mod.setYoutubeToken('brand-a', 'refresh_token_a_value');
    expect(mod.getYoutubeAccount('brand-a')).toEqual({ refreshToken: 'refresh_token_a_value' });
  });

  it('브랜드 격리 — A 저장이 B에 안 보임, B는 여전히 빈 토큰', () => {
    mod.setYoutubeToken('brand-a', 'token_a');
    expect(mod.getYoutubeAccount('brand-b')).toEqual({ refreshToken: '' });
    expect(mod.getYoutubeAccount('brand-a')).toEqual({ refreshToken: 'token_a' });
  });

  it('다른 브랜드 보존 — A·B 저장 후 B 갱신 → A 불변', () => {
    mod.setYoutubeToken('brand-a', 'token_a');
    mod.setYoutubeToken('brand-b', 'token_b');
    mod.setYoutubeToken('brand-b', 'token_b_updated');
    expect(mod.getYoutubeAccount('brand-a')).toEqual({ refreshToken: 'token_a' });
    expect(mod.getYoutubeAccount('brand-b')).toEqual({ refreshToken: 'token_b_updated' });
  });

  it('빈 문자열로 연결 해제 — A 저장 → setYoutubeToken("A", "") → 빈 토큰', () => {
    mod.setYoutubeToken('brand-a', 'token_a');
    mod.setYoutubeToken('brand-a', '');
    expect(mod.getYoutubeAccount('brand-a')).toEqual({ refreshToken: '' });
  });

  it('범용("") 슬러그도 blob 라운드트립', () => {
    mod.setYoutubeToken('', 'universal_token');
    expect(mod.getYoutubeAccount('')).toEqual({ refreshToken: 'universal_token' });
    const txt = fs.readFileSync(tmpEnv, 'utf-8');
    expect(txt).toContain('YOUTUBE_TOKENS=');
  });
});

// 메타(인스타·페북) 계정 파서 — 순수 함수(테스트만 실행, .env 접근 없음)
describe('parseMetaTokens', () => {
  it('정상 blob → 슬러그별 계정', () => {
    const raw = JSON.stringify({ 'brand-a': { pageId: '1', igUserId: '2', pageAccessToken: 't' } });
    expect(parseMetaTokens(raw)['brand-a']).toEqual({ pageId: '1', igUserId: '2', pageAccessToken: 't' });
  });
  it('빈 문자열·깨진 JSON·비객체 → 빈 맵', () => {
    expect(parseMetaTokens('')).toEqual({});
    expect(parseMetaTokens('{broken')).toEqual({});
    expect(parseMetaTokens('"str"')).toEqual({});
  });
});
