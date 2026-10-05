/**
 * 카드 모션 v2(2026-10-05) — 카드 머리줄(결론 한 줄) 고르기와 낭독 싱크 박자 산정. 전부 서버(노드)에서 정해
 * props 로 싣는다 — 렌더러는 받은 정수 프레임대로만 움직인다(같은 입력 → 같은 영상).
 *
 * 배경: 직접 제작 모션그래픽 파일럿(2026-10-05)은 채택하지 않되, 거기서 읽기 좋았던 점을 우리 카드로 옮긴다.
 *  · 머리줄 — 파일럿은 카드 위에 결론 한 줄을 얹었다. 다만 파일럿은 그 줄을 새로 지었다. 여기서는 대본에 이미
 *    있는 문장(내레이션의 한 문장 또는 그 마지막 절)만 쓴다 — 렌더러가 말을 지어내면 원문 대조(FACT_GATE)를 우회한다.
 *  · 박자 — 종전 카드는 고정 프레임(대비 4·16, 목록은 씬 60% 안 균등)에 떴다. 낭독은 그와 무관하게 흘러서
 *    ✓ 줄이 그 말을 하기 3초 전에 떠 있곤 했다. 낭독 mp3 의 쉼(ffmpeg silencedetect)을 문장·쉼표 경계에 맞춰
 *    문장별 실제 시각을 잡고, 문장 안은 글자 수 비례로 나눈다.
 *
 * 왜 STT 단어 시각이 아닌가: 파이프라인의 받아쓰기(voice/ttsCheck)는 수종명이 나온 씬에만, txt 로만 돌고 결과를
 * 남기지 않는다. 단어 시각을 쓰려면 씬마다 mlx_whisper 를 새로 돌리고 받아 적은 말을 대본에 다시 맞춰야 한다.
 * 쉼 위치는 TTS 에 넣은 <break> 태그(injectPauseBreaks — 문장·쉼표 경계)에서 나오므로 대본 경계와 바로 짝이 맞는다.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FPS, probeDuration } from './shortsCommon';
import type { SceneKindFields } from './shortsCommon';

const execFileP = promisify(execFile);

/** 공백 뺀 글자 수 — 구절 자막(phraseLen)과 같은 기준. */
const nsLen = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;
/** 비교용 정규화 — 한글·영숫자만 남긴다(공백·문장부호·가운뎃점 무시). */
const norm = (s: string): string => s.replace(/[^가-힣A-Za-z0-9]/g, '');
/** 어절 목록 — 문장부호·가운뎃점은 가름표로 본다("올해·작년" → 올해, 작년). */
const wordsOf = (s: string): string[] => s.split(/[^가-힣A-Za-z0-9]+/).filter(Boolean);
/** 어절 안 글자 2-gram 집합 — 어절 경계를 넘지 않는다(조사 붙은 어절도 어간 2자는 겹친다). */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of wordsOf(s)) {
    const ch = Array.from(w);
    for (let i = 0; i + 1 < ch.length; i++) out.add(ch[i]! + ch[i + 1]!);
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>): number => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

// ── 머리줄(결론 한 줄) ───────────────────────────────────────────────────────

/** 머리줄 길이(공백 뺀 글자) — 한 줄에 들어가야 한다. 18자 + 공백 몇 개가 46px 에서 카드 폭(≈900px) 안이다. */
export const HEADER_MIN = 6;
export const HEADER_MAX = 18;
/** 대비·목록·결론 카드가 그리는 글자(머리줄 관련성·중복 판정용). 카드가 없는 씬은 null. */
export function cardTexts(sc: SceneKindFields): string[] | null {
  if (sc.kind === 'compare' && sc.compare) {
    const { bad, good } = sc.compare;
    return [bad.label, bad.note ?? '', good.label, good.note ?? ''].filter(Boolean);
  }
  if (sc.kind === 'list' && sc.items?.length) return [...sc.items];
  if (sc.kind === 'cta' && sc.takeaways?.length) return sc.takeaways.flatMap((t) => [t.when, t.then]);
  return null;
}

/**
 * 머리줄 후보(순수) — 내레이션 문장 그대로, 길면 그 문장의 마지막 절(쉼표·연결 어미 뒤). 마지막 절이어야
 * 문장의 서술어(결론)를 갖는다. 앞 절만 떼면 "…정하고" 처럼 끝나지 않은 말이 된다.
 * 질문(?)·까닭 설명(…거든요)은 결론이 아니라 뺀다. 끝 문장부호는 떼고 돌려준다(카드 제목에 마침표는 군더더기).
 */
export function headerCandidates(narration: string): string[] {
  const text = (narration ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out: string[] = [];
  for (const sent of text.split(/(?<=[.!?…])\s+/)) {
    const s = sent.trim();
    if (!s || /\?\s*$/.test(s)) continue;
    let pick: string | undefined;
    if (nsLen(s) <= HEADER_MAX) pick = s;
    else {
      // 쉼표 → 연결 어미(고·면서·는데·지만·면) 순으로 마지막 절을 떼어 본다. 'X서'는 '위에서' 같은 조사와 갈리지 않아 뺀다.
      for (const re of [/(?<=,)\s+/, /(?<=(?:고|면서|는데|지만|면))\s+/]) {
        const parts = s.split(re).map((t) => t.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (parts.length > 1 && last && nsLen(last) <= HEADER_MAX) { pick = last; break; }
      }
    }
    if (!pick) continue;
    const clean = pick.replace(/[.!…,\s]+$/u, '').trim();
    if (nsLen(clean) < HEADER_MIN || nsLen(clean) > HEADER_MAX) continue;
    if (/거든요?$/.test(clean)) continue;
    // 서술어로 끝나는 결론 문장만(2026-10-05) — "향과 처진 가지, 그리고 봄 꽃" 같은 명사 나열은 머리줄이 아니라 항목이다
    // (모과 결론 카드: 두 줄 카드 위에 세 항목 나열이 올라 어긋났다).
    if (!/(요|다|죠|니다|세요)$/.test(clean)) continue;
    out.push(clean);
  }
  return out;
}

/** 카드 항목 수(순수) — 대비 2, 목록 항목 수, 결론 카드 줄 수. 카드가 아니면 undefined. */
export function cardItemCount(sc: SceneKindFields): number | undefined {
  if (sc.kind === 'compare' && sc.compare) return 2;
  if (sc.kind === 'list' && sc.items?.length) return sc.items.length;
  if (sc.kind === 'cta' && sc.takeaways?.length) return sc.takeaways.length;
  return undefined;
}

const COUNT_WORD: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
/**
 * 머리줄이 말하는 개수(순수) — "세 가지"·"두 곳"·"3단계"처럼 수량을 세는 말이 있으면 그 수, 없으면 undefined.
 * 2026-10-05 실측: 모과 결론 카드는 두 줄인데 머리줄이 내레이션의 "이 세 가지면 헛갈릴 일 없어요"를 집어 화면과 어긋났다.
 */
export function headerCount(text: string): number | undefined {
  const m = /(?:^|\s)(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|\d+)\s?(가지|개|단계|곳|군데|줄)/.exec(text);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : COUNT_WORD[m[1]!];
  return Number.isFinite(n) ? n : undefined;
}

/** a 와 b 가 사실상 같은 말인가 — 한쪽이 다른 쪽을 통째로 품으면 같다고 본다(같은 화면에 두 번 쓰지 않는다). */
function sameText(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * 카드 머리줄(순수) — 대비·목록·결론 카드 위에 얹을 결론 한 줄. 대본에 있는 글자만 쓴다(새 문장 생성 금지).
 * 규칙: headerCandidates 중 라벨(screenText)·카드 글자와 같지 않고, 카드 글자·라벨과 어절 2-gram 이 하나 이상
 * 겹치는 것(카드와 관련된 말). 겹침이 가장 많은 것, 같으면 뒤쪽(결론은 대개 씬 끝에 온다). 없으면 undefined — 머리줄 없음.
 */
export function cardHeaderFor(sc: SceneKindFields & { narration: string; screenText?: string }): string | undefined {
  const texts = cardTexts(sc);
  if (!texts) return undefined;
  const label = sc.screenText ?? '';
  const ref = bigrams([...texts, label].join(' '));
  let best: string | undefined, bestScore = 0;
  const items = cardItemCount(sc);
  for (const c of headerCandidates(sc.narration)) {
    if ((label && sameText(c, label)) || texts.some((t) => sameText(c, t))) continue;
    // 개수를 세는 머리줄은 카드 항목 수와 같을 때만 — 다르면 화면이 말과 어긋나 보인다.
    const cnt = headerCount(c);
    if (cnt !== undefined && cnt !== items) continue;
    const score = overlap(bigrams(c), ref);
    if (score >= 1 && score >= bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// ── 낭독 타임라인(쉼 위치) ───────────────────────────────────────────────────

export interface SpeechTimeline {
  durationSec: number;
  /** 첫 소리·마지막 소리(초) — 앞뒤 무음을 뺀 낭독 구간. */
  speechStart: number; speechEnd: number;
  /** 낭독 구간 안의 쉼(초, 시간순). */
  pauses: Array<{ start: number; end: number }>;
}

/** ffmpeg silencedetect 출력 → 타임라인(순수). 파일 맨 앞·맨 끝에 붙은 무음은 쉼이 아니라 낭독 구간 밖이다. */
export function parseSilencedetect(stderr: string, durationSec: number): SpeechTimeline {
  const sil: Array<{ start: number; end: number }> = [];
  let open: number | undefined;
  for (const m of stderr.matchAll(/silence_(start|end):\s*(-?[0-9.]+)/g)) {
    const v = Math.max(0, Number(m[2]));
    if (!Number.isFinite(v)) continue;
    if (m[1] === 'start') open = v;
    else if (open !== undefined) { sil.push({ start: open, end: Math.min(durationSec, v) }); open = undefined; }
  }
  if (open !== undefined) sil.push({ start: open, end: durationSec });
  let speechStart = 0, speechEnd = durationSec;
  const EDGE = 0.05;
  const pauses: Array<{ start: number; end: number }> = [];
  for (const s of sil) {
    if (s.start <= EDGE) speechStart = Math.max(speechStart, s.end);
    else if (s.end >= durationSec - EDGE) speechEnd = Math.min(speechEnd, s.start);
    else pauses.push(s);
  }
  if (!(speechEnd > speechStart)) { speechStart = 0; speechEnd = durationSec; }
  return { durationSec, speechStart, speechEnd, pauses: pauses.filter((p) => p.start > speechStart && p.end < speechEnd) };
}

/** 낭독 mp3 의 타임라인(ffmpeg 한 번, 수십 ms). 실패하면 undefined — 호출부는 종전 박자로 간다(fail-open). */
export async function probeSpeechTimeline(audioPath: string): Promise<SpeechTimeline | undefined> {
  try {
    const durationSec = await probeDuration(audioPath);
    const { stderr } = await execFileP('ffmpeg',
      ['-nostdin', '-hide_banner', '-i', audioPath, '-af', 'silencedetect=noise=-35dB:d=0.12', '-f', 'null', '-'],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    return parseSilencedetect(String(stderr), durationSec);
  } catch {
    return undefined;
  }
}

export interface SpokenSegment { text: string; startSec: number; endSec: number }

/**
 * 내레이션 절(문장·쉼표 경계)마다 실제 시각(순수). 경계마다 글자 비례 추정 시각을 내고, 그 근처(허용 0.6초 또는
 * 낭독의 20%)의 쉼 중 가장 가까운 것을 순서대로 짝짓는다(같은 거리면 긴 쉼 — break 태그 쉼이 숨 쉼보다 길다).
 * 짝이 없는 경계는 추정 시각을 쓴다. 쉼이 경계보다 적어도 된다 — injectPauseBreaks 는 씬당 break 3개 상한이다.
 */
export function alignSegments(narration: string, tl: SpeechTimeline): SpokenSegment[] {
  const segs = (narration ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…,])\s+/).map((t) => t.trim()).filter(Boolean);
  if (!segs.length) return [];
  const a = tl.speechStart, b = tl.speechEnd, span = b - a;
  const w = segs.map((s) => Math.max(1, nsLen(s)));
  const total = w.reduce((x, y) => x + y, 0);
  const tol = Math.max(0.6, span * 0.2);
  const bounds: Array<{ end: number; next: number }> = []; // 경계 b: 앞 절 끝·뒤 절 시작
  let acc = 0, lastUsed = -1;
  for (let i = 0; i < segs.length - 1; i++) {
    acc += w[i]!;
    const est = a + (span * acc) / total;
    let pick = -1, pickCost = Infinity;
    tl.pauses.forEach((p, j) => {
      if (j <= lastUsed) return;
      const d = Math.abs((p.start + p.end) / 2 - est);
      if (d > tol) return;
      const cost = d - 0.5 * (p.end - p.start);
      if (cost < pickCost) { pick = j; pickCost = cost; }
    });
    if (pick >= 0) { lastUsed = pick; bounds.push({ end: tl.pauses[pick]!.start, next: tl.pauses[pick]!.end }); }
    else bounds.push({ end: est, next: est });
  }
  return segs.map((text, i) => ({
    text,
    startSec: i === 0 ? a : bounds[i - 1]!.next,
    endSec: i === segs.length - 1 ? b : Math.max(i === 0 ? a : bounds[i - 1]!.next, bounds[i]!.end),
  }));
}

// ── 카드 박자 ────────────────────────────────────────────────────────────────

/** 카드 요소(등장 순서대로) — 대비 [✕, ✓], 목록 항목, 결론 행. 박자가 없는 카드는 null. */
export function cardElements(sc: SceneKindFields): string[] | null {
  if (sc.kind === 'compare' && sc.compare) {
    const { bad, good } = sc.compare;
    return [`${bad.label} ${bad.note ?? ''}`.trim(), `${good.label} ${good.note ?? ''}`.trim()];
  }
  if (sc.kind === 'list' && sc.items?.length) return [...sc.items];
  if (sc.kind === 'cta' && sc.takeaways?.length) return sc.takeaways.slice(0, 3).map((t) => `${t.when} ${t.then}`);
  return null;
}

/** 박자 상수 — 등장이 말보다 살짝 앞서야(LEAD) 말과 동시에 '자리 잡은' 모습이 된다. */
const BEAT_LEAD = 3;
/** 요소 사이 최소 간격(프레임) — 0.4초. 붙어 뜨면 순차 공개가 아니라 한꺼번에 뜬 것으로 읽힌다. */
export const BEAT_MIN_GAP = 12;
/** 마지막 요소 뒤 최소 읽을 시간(프레임) — 대비 카드는 ✓ 뒤 정답 알약이 더 뜬다(≈0.5초). */
export const BEAT_READ_TAIL = 45;

/**
 * 카드 요소별 등장 프레임(순수, 씬 로컬). 요소를 순서대로, 앞 요소 박자 + 최소 간격 뒤에 오는 절 중 어절 2-gram
 * (2점)·한 글자 어절(1점)이 가장 많이 겹치는 절을 찾고, 그 절 안에서 처음 겹치는 어절이 낭독되는 시각(절 안은 글자 비례)에
 * 맞춘다. 요소 2-gram 이 3개 이상이면 2-gram 2개 이상 겹쳐야 인정한다("나무" 하나 겹치는 우연은 버린다). 놓을 자리가
 * 없는 요소는 이웃 박자 사이에 고르게 놓는다. 인정된 요소가 하나도 없거나 읽을 시간이 안 남으면 undefined — 종전 박자(fail-open).
 */
export function cardBeats(elements: readonly string[], segs: readonly SpokenSegment[], durationInFrames: number, fps = FPS): number[] | undefined {
  if (!elements.length || !segs.length || !(durationInFrames > 0)) return undefined;
  const segWords = segs.map((s) => s.text.split(/\s+/).filter(Boolean));
  const segGrams = segs.map((s) => bigrams(s.text));
  const cap = durationInFrames - BEAT_READ_TAIL;
  // 요소를 순서대로 놓는다 — 앞 요소 박자 + 최소 간격 이후의 절만 후보다(같은 점수면 이른 절).
  let prev = -Infinity;
  const kept: Array<number | undefined> = elements.map((el) => {
    const g = bigrams(el);
    const singles = new Set(wordsOf(el).filter((x) => Array.from(x).length === 1));
    const need = g.size >= 3 ? 4 : 2; // 2-gram 은 2점, 한 글자 어절은 1점 — 한 글자 일치만으로는 못 붙는다
    let pick: number | undefined, pickScore = 0;
    segs.forEach((seg, k) => {
      const words = segWords[k]!;
      const score = 2 * overlap(g, segGrams[k]!) + words.filter((w) => singles.has(norm(w))).length;
      if (score < need || score <= pickScore) return;
      // 절 안에서 처음 겹치는 어절의 앞 글자 수 → 시각(절 안은 글자 비례).
      let before = 0;
      for (const w of words) {
        if (singles.has(norm(w)) || overlap(bigrams(w), g) > 0) break;
        before += nsLen(w);
      }
      const len = Math.max(1, nsLen(seg.text));
      const t = seg.startSec + ((seg.endSec - seg.startSec) * Math.min(before, len)) / len;
      // 끝자락에 말하는 요소는 읽을 시간 선(cap)까지 당긴다 — 버리면 등분 자리(말하기 한참 전)로 밀려난다.
      const f = Math.min(cap, Math.max(0, Math.round(t * fps) - BEAT_LEAD));
      if (f < prev + BEAT_MIN_GAP) return;
      pick = f; pickScore = score;
    });
    if (pick !== undefined) prev = pick;
    return pick;
  });
  if (kept.every((v) => v === undefined)) return undefined;
  // 버린 요소 메우기 — 왼쪽 박자(없으면 4프레임)와 오른쪽 박자(없으면 낭독 끝의 85%·cap 중 작은 쪽) 사이 등분.
  const out = [...kept];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== undefined) continue;
    let j = i;
    while (j < out.length && out[j] === undefined) j++;
    const left = i > 0 ? out[i - 1]! : 4 - BEAT_MIN_GAP;
    const speechEnd = Math.round(segs[segs.length - 1]!.endSec * fps);
    const right = j < out.length ? out[j]! : Math.min(cap + BEAT_MIN_GAP, Math.max(left + BEAT_MIN_GAP * (j - i + 1), Math.round(speechEnd * 0.85)));
    const n = j - i + 1;
    for (let k = i; k < j; k++) out[k] = Math.round(left + ((right - left) * (k - i + 1)) / n);
    i = j - 1;
  }
  const beats = out as number[];
  for (let i = 0; i < beats.length; i++) {
    if (beats[i]! < 0) beats[i] = 0;
    if (i > 0 && beats[i]! - beats[i - 1]! < BEAT_MIN_GAP) return undefined;
  }
  if (beats[beats.length - 1]! > cap) return undefined;
  return beats;
}

// ── 제목 캘리 아래 끝 ────────────────────────────────────────────────────────

/**
 * 상단 제목 캘리가 실제로 차지하는 아래 끝(px, 화면 위에서부터, 순수). TitleOverlay 는 폭 widthPct·높이 26% 상자에
 * contain·top 정렬로 그리므로, 그림 높이 = min(상자 높이, 폭 × 세로/가로). 카드는 이 아래에서 시작해야 캘리를 안 덮는다.
 */
export function titleBottomPx(img: { w: number; h: number }, topPct = 5, widthPct = 74, W = 1080, H = 1920): number | undefined {
  if (!(img.w > 0 && img.h > 0)) return undefined;
  const boxW = (W * widthPct) / 100, boxH = H * 0.26;
  return Math.round((H * topPct) / 100 + Math.min(boxH, (boxW * img.h) / img.w));
}
