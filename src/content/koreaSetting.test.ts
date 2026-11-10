import { describe, it, expect } from 'vitest';
import { koreaSettingLine, KOREA_SETTING } from './koreaSetting';
import { genPhotoPrompt } from '../orchestrator/cardLayout';
import { buildSceneImagePrompt } from '../orchestrator/shorts';

// 2026-11-10 사장님 "특별한 언급이 없는 한 한국이 배경이야" — 웹툰 샘플이 일본풍 마당으로 나왔다.
describe('koreaSettingLine', () => {
  it('언급 없으면 한국 배경', () => {
    expect(koreaSettingLine('감나무 묘목 끈 묶기')).toBe(KOREA_SETTING);
  });
  it('다른 나라를 말하면 붙이지 않는다', () => {
    expect(koreaSettingLine('일본 정원의 단풍나무')).toBe('');
    expect(koreaSettingLine('English garden roses')).toBe('');
  });
  it('지주가 나오면 둥근 지주 줄(각목 금지)', () => {
    expect(koreaSettingLine('지주 두 개를 세운 감나무')).toContain('[지주]');
    expect(koreaSettingLine('일본 정원 지주')).not.toContain('[배경 — 한국]');
    expect(koreaSettingLine('감나무 묘목')).not.toContain('[지주]');
  });
  it('카드·숏폼 지시에 들어간다', () => {
    expect(genPhotoPrompt('감나무 묘목', undefined)).toContain('[배경 — 한국]');
    expect(buildSceneImagePrompt({ style: '실사', scene: '감나무 묘목 마당', index: 1, total: 5 })).toContain('[배경 — 한국]');
  });
});
