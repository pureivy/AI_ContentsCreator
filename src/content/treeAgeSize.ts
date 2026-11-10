/**
 * 나이별 나무 크기 기준표(2026-11-10 사장님 확인) — 그림 지시와 그림 검수가 같은 표를 본다.
 *
 * 왜: 감나무 지지대 편 "2~3년생" 사진이 성목처럼 그려졌고, 검수는 손으로 적어 둔 대략 기준("1년생 = 연필~볼펜 굵기")으로
 * 판정해 그때그때 흔들렸다. 어제 목련 웹툰은 "20년 전 심은 나무"가 50년 넘은 노목처럼 그려졌다.
 * 숫자는 묘목 거래에서 흔한 크기와 생장 속도로 잡은 초안이다(공식 나이별 규격표는 못 찾았다). 수종 사전에 size 가 있으면 그것이 우선이다.
 * 근원경 = 땅 닿는 곳의 줄기 지름.
 */
import type { Species } from './species';

export type TreeGroup = 'fruit' | 'landscape' | 'shrub' | 'vine';

interface Row { lo: number; hi: number; label: string; ko: string; en: string }

const FRUIT_RE = /감|사과|배나무|^배$|밤|대추|매실|매화|자두|복숭아|살구|체리|앵두|플럼코트|모과|호두|석류|무화과|비파|귤|유자|Diospyros|Malus|Pyrus|Castanea|Ziziphus|Prunus|Cydonia|Chaenomeles|Juglans|Punica|Ficus/i;

const TABLE: Record<TreeGroup, Row[]> = {
  // 비례 우선(2026-11-10 사장님 "주변 대상과 비례해서") — 그림 모델은 cm 보다 '무엇만큼'으로 크기를 잡는다. 숫자는 뒤에 참고로.
  fruit: [
    { lo: 0, hi: 1, label: '1년생 접목묘', ko: '줄기가 어른 손가락 굵기(근원경 1~1.5cm), 꼭대기가 어른 허리~가슴·울타리(1.2m) 높이(1~1.5m), 외대 또는 곁가지 0~2개, 매끈한 껍질', en: 'trunk as thick as an adult\'s finger (1-1.5 cm), top reaches an adult\'s waist to chest, about garden-fence height (1-1.5 m), a single whip or 0-2 side shoots, smooth bark' },
    { lo: 2, hi: 3, label: '2~3년생', ko: '줄기가 엄지~빗자루 자루 굵기(2~4cm), 어른 키 안팎으로 단층집 처마(2.5m)보다 낮음(1.5~2.5m), 원가지 3~4개', en: 'trunk as thick as an adult\'s thumb or a broom handle (2-4 cm), about an adult\'s height and below single-story eaves (1.5-2.5 m), 3-4 main branches' },
    { lo: 4, hi: 5, label: '4~5년생', ko: '줄기가 손목 굵기(5~8cm), 단층집 처마 높이(2.5~3.5m), 원가지 3~4개에 곁가지', en: 'trunk as thick as an adult\'s wrist (5-8 cm), reaching single-story eaves (2.5-3.5 m), 3-4 main branches with side branches' },
    { lo: 6, hi: 14, label: '10년 안팎', ko: '줄기가 팔뚝~종아리 굵기(12~18cm), 단층집 지붕 높이(3~5m), 수형 완성', en: 'trunk as thick as an adult\'s forearm to calf (12-18 cm), about the roof of a single-story house (3-5 m), fully formed crown' },
    { lo: 15, hi: 40, label: '20년 안팎', ko: '줄기가 허벅지 굵기(20~30cm), 단층 지붕~2층 창 높이(4~6m, 전정한 과수)', en: 'trunk as thick as an adult\'s thigh (20-30 cm), from a single-story roof to a second-floor window (4-6 m, pruned fruit tree)' },
  ],
  landscape: [
    { lo: 0, hi: 1, label: '1년생', ko: '줄기가 연필 굵기(1cm 미만), 어른 무릎 높이·물뿌리개 한두 개 높이(0.3~0.6m)', en: 'stem as thin as a pencil (under 1 cm), knee-high to an adult, one or two watering cans tall (0.3-0.6 m)' },
    { lo: 2, hi: 3, label: '2~3년생', ko: '줄기가 엄지 굵기(2~3cm), 어른 가슴~키 높이(1.2~2m)', en: 'trunk as thick as an adult\'s thumb (2-3 cm), chest-high to an adult\'s height (1.2-2 m)' },
    { lo: 4, hi: 5, label: '4~5년생', ko: '줄기가 손목보다 조금 가는 굵기(4~6cm), 단층집 처마 높이(2.5~3.5m)', en: 'trunk slightly thinner than an adult\'s wrist (4-6 cm), reaching single-story eaves (2.5-3.5 m)' },
    { lo: 6, hi: 14, label: '10년 안팎', ko: '줄기가 팔뚝 굵기(10~15cm), 단층집 지붕보다 조금 높음(4~6m)', en: 'trunk as thick as an adult\'s forearm (10-15 cm), a little above a single-story roof (4-6 m)' },
    { lo: 15, hi: 40, label: '20년 안팎', ko: '줄기가 허벅지 굵기(18~28cm) — 사람 몸통보다 확실히 가늘고 노목의 퍼진 뿌리 밑동 없음, 2~3층 건물 높이(7~10m)', en: 'trunk as thick as an adult\'s thigh (18-28 cm), clearly narrower than a person\'s torso, no flared buttress roots of an old tree, as tall as a two- to three-story building (7-10 m)' },
  ],
  shrub: [
    { lo: 0, hi: 1, label: '1년생', ko: '물뿌리개 높이 안팎(0.2~0.4m), 줄기 1~2개', en: 'about as tall as a watering can (0.2-0.4 m), 1-2 stems' },
    { lo: 2, hi: 3, label: '2~3년생', ko: '어른 무릎~허리 높이(0.5~1m), 줄기 3~5개', en: 'knee- to waist-high to an adult (0.5-1 m), 3-5 stems' },
    { lo: 4, hi: 5, label: '4~5년생', ko: '어른 허리~가슴 높이(1~1.5m), 줄기 5~8개 덤불', en: 'waist- to chest-high to an adult (1-1.5 m), a bush of 5-8 stems' },
    { lo: 6, hi: 40, label: '6년 이상', ko: '어른 키 안팎(1.5~2.5m, 수종 최대를 넘지 않음), 굵은 줄기 여럿', en: 'about an adult\'s height (1.5-2.5 m, never above the species maximum), many thick stems' },
  ],
  vine: [
    { lo: 0, hi: 1, label: '1년생', ko: '줄기가 연필 굵기(0.5~1cm), 어른 키 안팎 길이(1~2m), 외줄기', en: 'single stem as thin as a pencil (0.5-1 cm), about an adult\'s height in length (1-2 m)' },
    { lo: 2, hi: 3, label: '2~3년생', ko: '원줄기가 손가락 굵기(1~2cm), 길이 2~4m, 곁줄기 몇 개', en: 'main stem as thick as a finger (1-2 cm), 2-4 m long, a few side shoots' },
    { lo: 4, hi: 5, label: '4~5년생', ko: '원줄기가 엄지~빗자루 자루 굵기(2~4cm), 껍질이 갈라져 벗겨지는 목질, 덕·울타리 일부를 덮음', en: 'main stem as thick as a thumb or broom handle (2-4 cm), woody with peeling bark, partly covering a trellis' },
    { lo: 6, hi: 14, label: '10년 안팎', ko: '원줄기가 손목 굵기(5~8cm), 굵게 꼬인 목질 줄기', en: 'main stem as thick as a wrist (5-8 cm), thick twisted woody trunk' },
    { lo: 15, hi: 40, label: '20년 안팎', ko: '원줄기가 팔뚝 굵기(8~15cm)', en: 'main stem as thick as a forearm (8-15 cm)' },
  ],
};

/** 수종 → 무리(순수). 사전 type 과 이름으로 가른다. 모르면 과수/조경을 이름으로, 그것도 모르면 조경 교목. */
export function treeGroup(sp?: Pick<Species, 'name' | 'latin' | 'type'>, text = ''): TreeGroup {
  const type = sp?.type ?? '';
  if (/덩굴/.test(type)) return 'vine';
  if (/관목/.test(type) && !/교목/.test(type)) return 'shrub';
  if (FRUIT_RE.test(`${sp?.name ?? ''} ${sp?.latin ?? ''}`) || (!sp && FRUIT_RE.test(text))) return 'fruit';
  return 'landscape';
}

const KNUM: Record<string, number> = { 일: 1, 한: 1, 이: 2, 두: 2, 삼: 3, 세: 3, 사: 4, 네: 4, 오: 5, 다섯: 5, 육: 6, 여섯: 6, 칠: 7, 일곱: 7, 팔: 8, 여덟: 8, 구: 9, 아홉: 9, 십: 10, 열: 10, 이십: 20, 스무: 20, 삼십: 30, 서른: 30 };
const N = String.raw`(\d+|이십|삼십|스무|서른|다섯|여섯|일곱|여덟|아홉|[일한이두삼세사네오육칠팔구십열])`;
const AGE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`${N}\s*(?:[~∼-]\s*${N}\s*)?년\s*(?:생|된|차|째|묵은|짜리)`),
  new RegExp(String.raw`심은\s*지\s*${N}\s*(?:[~∼-]\s*${N}\s*)?(?:년|해)`),
  new RegExp(String.raw`${N}\s*(?:[~∼-]\s*${N}\s*)?(?:년|해)\s*(?:전에?|동안|만에|지난|지킨|키운|자란)`),
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)(?:\s*(?:-|to)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty))?[- ]years?[- ]old\b/i,
];
// 영어 숫자 말(2026-11-10) — 웹툰 장면 목록은 영어로 'a one-year-old sapling' 이라 쓴다.
const ENUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
const num = (s?: string): number | undefined => (s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : KNUM[s] ?? ENUM[s.toLowerCase()]);

/** 글에서 나무 나이(년)를 뽑는다(순수). 숫자가 없고 '묘목·어린 나무'만 있으면 1~3, '당년생·삽수'는 0~1. 없으면 null. */
export function parseTreeAge(text: string): { lo: number; hi: number } | null {
  const t = String(text ?? '');
  for (const re of AGE_PATTERNS) {
    const m = re.exec(t);
    const a = num(m?.[1]);
    if (m && a !== undefined) {
      const b = num(m[2]);
      return { lo: a, hi: b !== undefined && b >= a ? b : a };
    }
  }
  if (/당년생|삽수|삽목|실생\s*1년/.test(t)) return { lo: 0, hi: 1 };
  if (/묘목|어린\s*[가-힣]*(?:나무|묘목)|유목|\bsaplings?\b|\byoung (?:tree|sapling)s?\b/i.test(t)) return { lo: 1, hi: 3 };
  if (/성목|다\s*자란\s*나무|\bmature tree\b/i.test(t)) return { lo: 10, hi: 40 };
  return null;
}

/** 나이 범위에 걸치는 줄(순수) — 1~3 이면 1년생·2~3년생 두 줄. */
export function ageRows(group: TreeGroup, age: { lo: number; hi: number }): Row[] {
  return TABLE[group].filter((r) => r.hi >= age.lo && r.lo <= age.hi).slice(0, 2);
}

/**
 * 비례 기준(2026-11-10 사장님 "주변 대상과 비례해서 그려야") — 크기는 화면 안 다른 물건과의 비례로 정해진다.
 * 사람·손이 없는 장면은 원래 있을 법한 배경(울타리·처마·화분·지주)으로 크기를 잡는다(지주·끈은 장면에 있을 때만).
 */
// 비교 물건 강제 뺌(2026-11-10 사장님 감나무 시험) — '사람 없으면 물뿌리개·벽돌을 두라'고 하니 흙 위에 일부러 놓은 벽돌·물뿌리개가
// 장마다 들어가 연출 티가 났다. 크기는 장면에 원래 있을 법한 배경(울타리·처마·화분·지주)으로 잡고, 크기만을 위한 소품은 넣지 않는다.
export const SCALE_RULE = 'Draw the tree in true proportion to what is naturally in the scene. '
  + 'Judge its size against background that would really be there — a garden fence (about 1.2 m), single-story house eaves (about 2.5 m), '
  + 'a pot or a stake the scene already describes — and keep the trunk thickness and height consistent with it. '
  + 'Do not add props just for scale (no watering cans, bricks or tools placed on the ground). '
  + 'Do not add stakes or ties unless the scene describes them. In close-ups the trunk keeps its real thickness relative to nearby objects (a thumb-thick trunk stays thumb-thick). '
  + 'Never draw it older, taller or thicker than this.';

// 덩굴 모양(2026-11-10 으름 재시도) — 덩굴에 '원줄기 손가락 굵기'만 주니 FLUX 가 혼자 선 나무(굵은 밑동·퍼진 뿌리)로 그렸다.
// 덩굴은 줄기가 혼자 서지 못하고 지주를 감는다는 모양 자체를 글로 못박는다.
export const VINE_FORM = 'It is a climbing vine, not a tree or shrub: it has no trunk and cannot stand up on its own. '
  + 'Its stems are thin, flexible and twining, about the same thickness from the base to the tip, winding around a support or lying loosely; '
  + 'no flared roots, no swollen base, no woody tree trunk.';

/** 그림 지시 줄(순수, 영어) — 나이가 없으면 ''. 사전 size 가 있으면 함께 싣는다(사전이 우선). */
export function ageSizePrompt(text: string, sp?: Pick<Species, 'name' | 'latin' | 'type' | 'size'>, o: { english?: boolean } = {}): string {
  const age = parseTreeAge(text);
  if (!age) return '';
  const rows = ageRows(treeGroup(sp, text), age);
  if (!rows.length) return '';
  // english(2026-11-10) — 웹툰 장면 목록 그림 필드는 영어만(SHORT_marker lint 가 한글을 막는다). 라벨은 나이 숫자로, 사전 size(한글)는 뺀다.
  const label = (r: Row): string => (o.english ? (r.lo <= 1 && r.hi <= 1 ? '1 year old' : `${Math.max(1, r.lo)}-${r.hi} years old`) : r.label);
  const size = sp?.size && !o.english ? ` Species size data (takes priority): ${sp.size}.` : '';
  const form = treeGroup(sp, text) === 'vine' ? ` ${VINE_FORM}` : '';
  return `[Tree size for its age — follow exactly] ${rows.map((r) => `${label(r)}: ${r.en}`).join(' / ')}.${size}${form} ${SCALE_RULE}`;
}

/** 검수 줄(순수, 한국어) — 그 나이의 기준 크기. 나이가 없으면 ''. */
export function ageSizeCheck(text: string, sp?: Pick<Species, 'name' | 'latin' | 'type' | 'size'>): string {
  const age = parseTreeAge(text);
  if (!age) return '';
  const rows = ageRows(treeGroup(sp, text), age);
  return rows.map((r) => `${r.label} = ${r.ko}`).join(' / ');
}

/** 검수 기준표 전체(순수, 한국어) — 그 무리의 모든 줄. */
export function ageSizeTable(sp?: Pick<Species, 'name' | 'latin' | 'type' | 'size'>, text = ''): string {
  const g = treeGroup(sp, text);
  const name = { fruit: '과수 교목', landscape: '조경 교목', shrub: '관목', vine: '덩굴' }[g];
  return `${name} 나이별 크기(근원경 = 땅 닿는 곳 줄기 지름): ${TABLE[g].map((r) => `${r.label} ${r.ko}`).join(' / ')}${sp?.size ? ` · 이 수종 자료(우선): ${sp.size}` : ''}`;
}
