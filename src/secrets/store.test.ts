import { describe, it, expect } from 'vitest';
import { parseEnvText, upsertEnvText, maskSecret } from './store';

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
