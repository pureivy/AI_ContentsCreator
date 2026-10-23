// 상단 제목 글꼴(고운돋움) — 숏폼 캘리 제목 대신 글자로 쓰는 제목. loadFonts.ts 와 같은 방식으로 렌더 전에 싣는다.
import { continueRender, delayRender } from 'remotion';
import url from '../fonts/GowunDodum-Regular.ttf';

export const TITLE_FONT = '"Gowun Dodum", Pretendard, sans-serif';

const handle = delayRender('제목 글꼴(고운돋움) 로딩');
new FontFace('Gowun Dodum', `url(${url}) format('truetype')`)
  .load()
  .then((f) => { document.fonts.add(f); })
  .catch((e: unknown) => { console.warn('[폰트] 고운돋움 로딩 실패:', e); })
  .then(() => { continueRender(handle); });
