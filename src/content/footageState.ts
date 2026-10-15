/**
 * 실촬영 화면 ↔ 글 상태 대조(순수, 2026-10-15) — 숏폼 훅·카드 표지 공용.
 * 실측: 10-04 촬영 호두나무(잎·초록 열매 달림) 위에 "잎 다 떨어진 이 나무"(숏폼), 같은 글의 카드 표지 "잎 다 떨어졌는데 죽은 걸까요".
 */
/** 화면 부위별 '없음·상함' 말과 '가득함' 말(훅 화면 어긋남 검사 공용). mention 은 판독문에 그 부위가 보인다고 적혔는지. */
export const FOOTAGE_PARTS: ReadonlyArray<{ name: string; absent: RegExp; full: RegExp; mention: RegExp }> = [
  { name: '잎', absent: /(?:잎|싹|새순)[이가은는]?\s*(?:다\s*)?(?:안\s|안나|못\s|없|떨어|떨군|떨궈|진\s|진\s*뒤|졌|지고|말라|마르|시들|누렇|갈변)/, full: /(?:잎|잎사귀)[이가]?\s*(?:무성|가득|풍성|빽빽|싱싱|무럭)|(?:초록|푸른|무성한|싱그러운)\s*잎|잎이\s*달린|잎\s*달린/, mention: /잎/ },
  { name: '꽃', absent: /꽃[이은]?\s*(?:안\s|안피|못\s|없)|개화\s*(?:안|불량|실패)/, full: /꽃[이가]?\s*(?:만개|활짝|가득|피어|핀\s)|만개|꽃\s*핀/, mention: /꽃/ },
  { name: '열매', absent: /(?:열매|호두|감|대추|사과|배)[가이는은]?\s*(?:안\s|안열|못\s|없|안\s*달)|결실\s*(?:안|불량)/, full: /(?:열매|호두|감|대추)[가이]?\s*(?:주렁|가득|달려|맺혀|달린)|주렁주렁/, mention: /열매/ },
];

/** '지금' 표지 — 다른 씬이 지금 나무 상태를 말하는가. 첫 장면 실촬영은 이번 달(없으면 지난달) 촬영이라 지금의 실제 나무다. */
export const NOW_RE = /지금|요즘|이맘때|이번\s*달|요새/;

/**
 * 훅 글이 훅 화면과 어긋나는가(순수, 2026-10-15) — 씬1 내레이션·자막이 "잎이 다 졌어요"라고 하는데 그 씬에 나가는 실촬영
 * 판독문에는 잎이 보인다고 적힌 경우. 실측: 호두나무 활착(short_6b8abad39b) — 10-04 촬영 영상(잎·초록 열매가 아직 달림) 위에 "잎 다 떨어진 이 나무". 잎이 보인다고 여름 영상인 게 아니다 — 대본이 실제 나무 상태를 앞질러 단정한 것이다.
 * footageContradictsTopic 은 글 제목만 봐서("상강 앞두고 가지로 진단") 못 잡았다 — 이건 작가가 실제로 쓴 훅을 본다.
 * 판독문이 그 부위를 '없다·상했다'고 적었으면 어긋남이 아니다.
 */
export function hookContradictsFootage(hookText: string, footage: string | undefined): string {
  if (!footage || !hookText.trim()) return '';
  const h = hookText.replace(/\s+/g, ' ');
  const f = footage.replace(/\s+/g, ' ');
  for (const p of FOOTAGE_PARTS) {
    if (p.absent.test(h) && (p.full.test(f) || (p.mention.test(f) && !p.absent.test(f)))) return `훅은 ${p.name}이 없다고 말하는데 화면에는 ${p.name}이 보인다(화면: ${f.slice(0, 40)})`;
  }
  if (/(?:고사|죽어|죽은|말라\s*죽|시들)/.test(h) && !/죽은\s*걸까|죽었을까|죽은\s*건지|죽었나/.test(h) && /(?:싱싱|무성|건강|푸르게|초록)/.test(f)) return `훅은 나무가 죽었다고 말하는데 화면은 싱싱한 나무(화면: ${f.slice(0, 40)})`;
  return '';
}


/**
 * 카드 표지 실촬영 대조(순수) — 표지(1번 카드)는 그 사진 위에 얹히므로 무엇이든 대조하고, 다른 장은 '지금' 나무 상태를 단정할 때만.
 * 표지 사진은 블로그 실촬영(이번 달 촬영, 없으면 지난달)이라 사장님 밭의 지금 나무다.
 */
export function cardPhotoIssues(slides: ReadonlyArray<{ headline: string; body?: string }>, photo: string | undefined): string[] {
  if (!photo) return [];
  const out: string[] = [];
  slides.forEach((s, i) => {
    const t = `${s.headline} ${s.body ?? ''}`;
    if (i > 0 && !NOW_RE.test(t)) return;
    const w = hookContradictsFootage(t, photo).replace(/^훅은/, '문구는');
    if (!w) return;
    out.push(i === 0
      ? `1번 카드(표지): 표지 문구가 표지 실촬영 사진과 어긋난다 — ${w}. 사진에 보이는 상태와 맞게 고치거나, 상태를 단정하지 않는 문구로 바꿔라`
      : `${i + 1}번 카드: 지금 나무 상태를 표지 실촬영과 다르게 말한다 — ${w}. "지금 ~가 졌다" 같은 단정을 빼거나 "지고 나면"처럼 조건으로 바꿔라`);
  });
  return out;
}
