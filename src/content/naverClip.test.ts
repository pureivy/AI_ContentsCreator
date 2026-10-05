import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClipDescription, pickClipVideo, blogLogNoFromUrl, canPublishClip, CLIP_DESCRIPTION_MAX, pickClipSearchTerms, buildClipSearchDescription, clipPlaylistName, clipNudgeDue, CLIP_MAX_HASHTAGS, pickClipDescription } from './naverClip';

// 클립엔 제목 칸이 없고 설명 300자가 전부다(2026-10-02 정찰) — 제목·본문·해시태그를 한 칸에 넣는다.
describe('buildClipDescription — 클립 설명 300자', () => {
  it('제목 / 본문 / 해시태그를 빈 줄로 잇는다', () => {
    expect(buildClipDescription('배롱나무 겨울전정', '잎이 떨어진 뒤에 하세요.', ['배롱나무', '#전정']))
      .toBe('배롱나무 겨울전정\n\n잎이 떨어진 뒤에 하세요.\n\n#배롱나무 #전정');
  });
  it('넘치면 본문만 자르고 제목·해시태그는 남긴다', () => {
    const out = buildClipDescription('제목', '가'.repeat(500), ['나무', '정원']);
    expect(out.length).toBeLessThanOrEqual(CLIP_DESCRIPTION_MAX);
    expect(out.startsWith('제목\n\n')).toBe(true);
    expect(out.endsWith('…\n\n#나무 #정원')).toBe(true);
  });
  it('태그는 공백을 빼고 중복을 지운다', () => {
    expect(buildClipDescription('t', '', ['대추 나무', '#대추나무', ' '])).toBe('t\n\n#대추나무');
  });
  it('제목과 태그만으로 넘치면 뒤쪽 태그부터 뺀다', () => {
    const tags = Array.from({ length: 80 }, (_, i) => `태그${i}`);
    const out = buildClipDescription('제목', '본문', tags);
    expect(out.length).toBeLessThanOrEqual(CLIP_DESCRIPTION_MAX);
    expect(out).toContain('#태그0');
    expect(out).not.toContain('#태그79');
  });
  it('유튜브 전용 태그(#shorts)는 뺀다', () => {
    expect(buildClipDescription('t', '', ['배롱나무', '#shorts', 'Shorts', '쇼츠'])).toBe('t\n\n#배롱나무');
  });
  it('본문이 비면 제목과 태그만', () => {
    expect(buildClipDescription('제목', '  ', [])).toBe('제목');
  });
});

describe('pickClipVideo — 원본만 올린다', () => {
  it('final.mp4 가 있으면 그것, 없으면 null(저화질 preview.mp4 로 대신하지 않는다)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
    fs.writeFileSync(path.join(dir, 'preview.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'download.mp4'), 'x');
    expect(pickClipVideo(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'final.mp4'), 'x');
    expect(pickClipVideo(dir)).toBe(path.join(dir, 'final.mp4'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('blogLogNoFromUrl', () => {
  it('두 주소 꼴에서 글 번호를 뽑는다', () => {
    expect(blogLogNoFromUrl('https://blog.naver.com/biondi_tree/224429014634')).toBe('224429014634');
    expect(blogLogNoFromUrl('http://m.blog.naver.com/PostView.naver?blogId=biondi_tree&logNo=224428543778&navType=tl')).toBe('224428543778');
  });
  it('글 주소가 아니면 null', () => {
    expect(blogLogNoFromUrl('https://blog.naver.com/biondi_tree/postwrite')).toBeNull();
    expect(blogLogNoFromUrl(undefined)).toBeNull();
  });
});

describe('canPublishClip — 유튜브용과 레거시만', () => {
  it('인스타용은 막는다', () => {
    expect(canPublishClip('youtube')).toBe(true);
    expect(canPublishClip(undefined)).toBe(true);
    expect(canPublishClip('instagram')).toBe(false);
  });
});

// 2026-10-05 — 클립은 검색으로 발견된다. 원본 글의 실제 유입 검색어를 첫 줄·태그에 쓴다(실측 유입 표본에서 가져온 예).
describe('pickClipSearchTerms — 실제 검색어로 첫 줄·태그', () => {
  const list = [
    { name: '감나무', aliases: ['단감나무'] },
    { name: '배롱나무', aliases: ['백일홍'] },
    { name: '측백나무' },
    { name: '하스카프나무', aliases: ['하스카프베리'] },
    { name: '소나무' },
  ];
  const gam = list[0]!;
  const inflow = [
    { keyword: '감나무 흰곰팡이', count: 2 },
    { keyword: '감나무 흰곰팡이병', count: 2 },
    { keyword: '감 하얀벌레', count: 1 },
    { keyword: '감나무 가지 끝쪽 아래에 하얀 가루 같은 것이 있는데 무슨 병인가요', count: 1 },
    { keyword: '배롱나무 끈적임', count: 1 },
    { keyword: '감나무 깍지벌레', count: 1 },
    { keyword: '나무 하얀가루', count: 1 },
  ];
  it('첫 줄 = 제목에 없는 가장 많이 들어온 검색어', () => {
    const r = pickClipSearchTerms({ title: '감나무 잎 흰가루, 이렇게 구별합니다', body: '', inflow, species: gam, speciesList: list });
    expect(r.lead).toBe('감나무 흰곰팡이');
  });
  it('남의 수종·질문형 긴 문장·수종 없는 넓은 말은 태그에서 뺀다', () => {
    const r = pickClipSearchTerms({ title: 't', body: '', inflow, species: gam, speciesList: list });
    expect(r.tags).toEqual(['#감나무흰곰팡이', '#감나무흰곰팡이병', '#감나무깍지벌레']);
    expect(r.tags.join(' ')).not.toContain('배롱나무');
    expect(r.tags.join(' ')).not.toContain('하얀가루');
  });
  it('제목에 이미 든 검색어는 첫 줄로 다시 쓰지 않고 다음 것을 본다', () => {
    const r = pickClipSearchTerms({ title: '감나무 흰곰팡이 잡는 법', body: '', inflow, species: gam, speciesList: list });
    expect(r.lead).toBe('감나무 흰곰팡이병');
  });
  it('유입이 비면 주 키워드 → 숏폼 태그(최대 5개, 브랜드·남의 수종 제외)', () => {
    const r = pickClipSearchTerms({
      title: '측백나무 울타리 간격', body: '', keyword: '측백나무 전정시기', species: list[2], speciesList: list,
      hashtags: ['#측백나무', '#생울타리', '#소나무전정', '#비온디트리', '#원예초보', '#정원수', '#조경수', '#shorts'],
    });
    expect(r.lead).toBe('측백나무 전정시기');
    expect(r.tags).toEqual(['#측백나무전정시기', '#측백나무', '#생울타리', '#원예초보', '#정원수']);
    expect(r.tags.length).toBeLessThanOrEqual(CLIP_MAX_HASHTAGS);
  });
  it('별칭·어간으로도 같은 수종으로 본다(하스카프베리)', () => {
    const r = pickClipSearchTerms({ title: 't', body: '', inflow: [{ keyword: '하스카프 베리 묘목', count: 1 }, { keyword: '누운소나무심는방향', count: 1 }], species: list[3], speciesList: list });
    expect(r.lead).toBe('하스카프 베리 묘목');
    expect(r.tags).toEqual(['#하스카프베리묘목']);
  });
  it('수종 없는 글은 키워드 낱말이 겹치는 검색어만', () => {
    const r = pickClipSearchTerms({ title: '칠월 꽃', body: '', keyword: '7월에 심는 꽃', inflow: [{ keyword: '7월에 심는 꽃 종류', count: 3 }, { keyword: '장마 화분', count: 1 }], speciesList: list });
    expect(r.lead).toBe('7월에 심는 꽃 종류');
    expect(r.tags[0]).toBe('#7월에심는꽃종류');
    expect(r.tags).not.toContain('#장마화분');
  });
  it('이름이 없어도 두 번 이상 들어온 검색어는 쓴다(생김새로 찾는 수요) — 1번짜리는 안 쓴다', () => {
    const r = pickClipSearchTerms({ title: '좀작살나무 이름 유래', body: '', species: { name: '좀작살나무' }, speciesList: [{ name: '좀작살나무' }, { name: '소나무' }],
      inflow: [{ keyword: '보라색 알갱이', count: 2 }, { keyword: '보라색 줄줄이 열매', count: 1 }, { keyword: '소나무 보라색 열매', count: 3 }] });
    expect(r.lead).toBe('보라색 알갱이');
    expect(r.tags).toEqual(['#보라색알갱이']);
  });
  it('브랜드·판매처 이름이 든 검색어는 안 쓴다', () => {
    const r = pickClipSearchTerms({ title: 't', body: '', inflow: [{ keyword: '감나무 묘목 농원', count: 5 }, { keyword: '비온디 감나무', count: 4 }], species: gam, speciesList: list });
    expect(r.lead).toBeUndefined();
    expect(r.tags).toEqual([]);
  });
});

describe('buildClipSearchDescription — 첫 줄 검색어 + 제목 + 본문 + 태그', () => {
  it('검색어와 제목은 붙여 두고(제목 줄로 중복 검사), 300자 안', () => {
    const out = buildClipSearchDescription({
      title: '감나무 잎 흰가루, 이렇게 구별합니다', body: '가'.repeat(400),
      inflow: [{ keyword: '감나무 흰곰팡이', count: 2 }], species: { name: '감나무' }, speciesList: [{ name: '감나무' }],
    });
    expect(out.length).toBeLessThanOrEqual(CLIP_DESCRIPTION_MAX);
    expect(out.startsWith('감나무 흰곰팡이\n감나무 잎 흰가루, 이렇게 구별합니다\n\n')).toBe(true);
    expect(out.endsWith('#감나무흰곰팡이')).toBe(true);
  });
  it('검색어가 없으면 종전 꼴 그대로', () => {
    expect(buildClipSearchDescription({ title: '제목', body: '본문', hashtags: ['나무'] })).toBe(buildClipDescription('제목', '본문', ['나무']));
  });
});

describe('clipPlaylistName — 수종 재생목록', () => {
  it('"<수종> 키우기", 수종을 모르면 없음', () => {
    expect(clipPlaylistName({ name: '감나무' })).toBe('감나무 키우기');
    expect(clipPlaylistName(undefined)).toBeUndefined();
  });
});

describe('clipNudgeDue — 클립 권유는 한 편에 한 번', () => {
  const base = { stage: 'ready', platform: 'youtube' };
  const ok = { hasFinal: true, inFlight: false };
  it('완성된 유튜브용 편이면 보낸다', () => {
    expect(clipNudgeDue(base, ok)).toBe(true);
    expect(clipNudgeDue({ stage: 'ready' }, ok)).toBe(true); // 레거시(채널 미지정)
  });
  it('이미 보냈거나·올라갔거나·등록 미확인·대기·업로드 중이면 안 보낸다', () => {
    expect(clipNudgeDue({ ...base, naverClipNudgedTs: 'x' }, ok)).toBe(false);
    expect(clipNudgeDue({ ...base, naverClipNo: '1' }, ok)).toBe(false);
    expect(clipNudgeDue({ ...base, naverClipSubmittedTs: 'x' }, ok)).toBe(false);
    expect(clipNudgeDue({ ...base, naverClipQueuedTs: 'x' }, ok)).toBe(false);
    expect(clipNudgeDue(base, { hasFinal: true, inFlight: true })).toBe(false);
  });
  it('인스타용·미완성·원본 정리된 편은 안 보낸다', () => {
    expect(clipNudgeDue({ stage: 'ready', platform: 'instagram' }, ok)).toBe(false);
    expect(clipNudgeDue({ stage: 'rendering', platform: 'youtube' }, ok)).toBe(false);
    expect(clipNudgeDue(base, { hasFinal: false, inFlight: false })).toBe(false);
  });
});

// 리뷰(2026-10-05) — 재업로드가 새 설명을 만들면 전체 설명 중복 검사가 지난 시도의 클립을 못 알아본다.
describe('pickClipDescription — 확인·재업로드는 저장된 설명 그대로', () => {
  it('저장된 설명이 있으면 실제 업로드·확인 모두 그것', () => {
    expect(pickClipDescription('새 설명', '지난 설명', false)).toBe('지난 설명');
  });
  it('저장된 설명이 없거나 비면 새로 만든 설명', () => {
    expect(pickClipDescription('새 설명', undefined, false)).toBe('새 설명');
    expect(pickClipDescription('새 설명', '  ', false)).toBe('새 설명');
  });
  it('드라이런은 새로 만든 설명(미리보기)', () => {
    expect(pickClipDescription('새 설명', '지난 설명', true)).toBe('새 설명');
  });
});
