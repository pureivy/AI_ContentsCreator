/**
 * 롱폼 완성 장면 검토(2026-10-23, LONGFORM_REVIEW) — 리뷰어(정하람)가 장면마다 55% 스틸을 보고 다시 그릴 장면을 고른다.
 *
 * 대조표(contact.jpg)는 칸에 장면 키가 안 찍혀 있어 어느 칸이 어느 장면인지 모델이 말할 수 없다 — 그래서 장면 스틸을 8장씩
 * (claudeCli 비전 상한) 묶어 "이미지 i = 장면 키 / 문장" 목록과 함께 준다. 비전이 안 되는 모델이거나 스틸이 없으면 문장 +
 * 화면 라벨(장면 파일의 const L… 상수)만으로 글 검토를 한다. 고를 장면은 묶음마다 심각한 것만, 합쳐서 심각도순 상위 REVIEW_MAX.
 * 실패(응답 없음·예외)는 그 묶음만 건너뛴다 — 전체가 비면 null(검토 없이 진행).
 */
import { microJSON } from './agent';
import { stdModel, visionCapable } from './visionCommon';
import type { EventBus } from '../events/bus';
import { emitStaffSpawn, staffOfficeStart, staffRole, staffSay, staffSystem } from './longformStaff';
import { REVIEW_MAX, type ReviewItem, type ReviewRef, type ReviewVerdict, type SceneReviewFn } from './longformScenes';
import { PART_KO, partsFromText, pickCommons, type RefPart } from '../longform/speciesCommons';

export const REVIEWER = 'reviewer';
/** 비전 한 번에 보는 장면 수(claudeCli visionPaths 8장 상한). */
export const REVIEW_CHUNK = 8;
/** 글 검토 한 번에 보는 장면 수. */
export const REVIEW_TEXT_CHUNK = 40;

/** 사장님 검토에서 나온 기준(2026-10-22~23) — 디자이너 기억과 같은 줄. */
export const REVIEW_RUBRIC = [
  '비유를 글자 그대로 그렸다(예: "밑천" → 동전). 문장의 실제 뜻(예: 뿌리·줄기에 저장된 양분)을 그려야 한다.',
  '계절과 맞지 않는다(겨울 작업 장면에 잎·꽃 뭉치, 잎 진 뒤 작업인데 잎이 무성).',
  '화면 글자·숫자가 그 문장에 없다(달력에 문장에 없는 월, 문장에 없는 수치).',
  '빈 화면이거나 문장과 관계없는 그림이다(짧은 연결 문장도 앞 문장의 대상을 작게 이어 그려야 한다).',
  '크기 비례가 어색하다(묘목이 사람보다 크다, 구덩이·화분 크기가 문장과 어긋남).',
  '글자·부품이 겹치거나 잘려 읽히지 않는다.',
  '실물 형태와 다르다(잎·꽃·열매·수형·껍질) — 실물 대조용 사진이 있으면 그 수종 진짜 모습과 비교한다(잎 모양·가장자리·나는 방식, 꽃잎 수, 열매 모양, 수형, 껍질 무늬).',
];

export type VisionJSON = <T>(model: string, system: string, user: string, opts: { maxOutputTokens?: number; signal?: AbortSignal; visionPaths?: readonly string[] }) => Promise<T | null>;

/**
 * 검토 지시문(순수). vision=true 면 이미지 순서 = refs(실물 대조용 사진, 있으면 앞에) 다음 items 순서.
 * refs = 이 묶음 앞에 붙인 실물 사진(장마다 하나씩) — 수종 이름만(우리 실촬영) 또는 { nameKo, part }(part 가 있으면 공개 도감 사진).
 */
export function reviewPrompt(items: readonly ReviewItem[], o: { vision: boolean; title?: string; limit: number; refs?: ReadonlyArray<string | { nameKo: string; part?: RefPart }> }): { system: string; user: string } {
  const nRef = o.vision ? (o.refs?.length ?? 0) : 0;
  const refs = (o.refs ?? []).map((r) => (typeof r === 'string' ? { nameKo: r } : r) as { nameKo: string; part?: RefPart });
  const anyExt = refs.some((r) => r.part);
  return {
    system: '너는 나무 정원 유튜브 롱폼 영상의 최종 검토자다. 문장마다 그려진 모션그래픽 장면을 보고, 다시 그려야 할 장면만 고른다. 요청된 JSON 만 출력한다.',
    user: [
      ...(o.title ? [`[이 편] ${o.title}`] : []),
      ...(nRef && !anyExt ? [`[실물 대조용 사진] 이미지 ${nRef > 1 ? `1~${nRef}` : '1'} = ${[...new Set(refs.map((r) => r.nameKo))].join('·')} 실제 모습(보관소 실촬영, 장면이 아님). 장면의 식물을 이 사진과 비교한다 — 계절 차이(잎·열매 유무)는 문장의 때를 따르므로 형태만 본다.`] : []),
      ...(nRef && anyExt ? [
        '[실물 대조용 사진 — 우리 실촬영 / 공개 도감 사진(출처 기록됨), 장면이 아님] 장면의 식물을 이 사진과 비교한다 — 계절 차이(잎·열매 유무)는 문장의 때를 따르므로 형태만 본다.',
        ...refs.map((r, i) => `이미지 ${i + 1} = ${r.nameKo} ${r.part ? `${PART_KO[r.part]} — 공개 도감 사진(Wikimedia Commons, 내부 대조용)` : '실제 모습 — 우리 실촬영(보관소)'}`),
      ] : []),
      o.vision
        ? `[장면] ${nRef ? `이미지 ${nRef + 1}~${nRef + items.length}` : `이미지 ${items.length}장`}이 아래 순서대로 붙어 있다(각 장면의 55% 시점 스틸 — 아래쪽 자막 띠는 따로 얹히므로 비어 있어도 된다).`
        : '[장면] 그림 대신 장면마다 화면에 쓰인 라벨을 준다. 문장과 라벨만으로 판단한다.',
      ...items.map((it, i) => `${o.vision ? `이미지 ${nRef + i + 1}` : `-`} = ${it.key} | 장: ${it.chapterTitle}${it.species?.length ? ` (수종 ${it.species.join('·')})` : ''} | 문장: ${it.narration}${it.labels.length ? ` | 화면 글자: ${it.labels.join(' / ')}` : ''}`),
      '',
      '[다시 그릴 기준 — 이런 장면만 고른다]',
      ...REVIEW_RUBRIC.map((r, i) => `${i + 1}. ${r}`),
      '',
      `조금 아쉬운 정도는 고르지 마라 — 시청자가 보고 틀렸다고 느낄 장면만. 많아야 ${o.limit}개, 없으면 빈 배열.`,
      'reason 은 디자이너가 바로 고칠 수 있게 무엇이 틀렸고 무엇을 그려야 하는지 한 문장(한국어 80자 이내). severity 는 3(틀림)·2(어색함)·1(사소함).',
      '{"redo":[{"key":"s012","reason":"…","severity":3}]}',
    ].join('\n'),
  };
}

/** 비전 묶음 하나에 앞붙일 실물 사진 수(나머지는 장면 스틸). */
export const REVIEW_REFS = 2;
/**
 * 묶음 첫 장면의 수종 실물 사진(순수) — 그 수종 사진에서 REVIEW_REFS 장. 수종이 없거나 사진이 없으면 없음.
 * window = 이 묶음에 들 장면들(첫 장면부터) — 문장에 부위(껍질·꽃·겨울·묘목 …)가 나오고 그 부위 공개 도감 사진이 있으면
 * 실촬영 1장 + 그 부위 도감 사진(8장 상한은 REVIEW_REFS 로 그대로). 부위 단서가 없으면 실촬영 먼저, 실촬영이 없으면 도감 사진.
 */
export function chunkRefs(window: ReviewItem | readonly ReviewItem[], refs: readonly ReviewRef[]): ReviewRef[] {
  const items: readonly ReviewItem[] = Array.isArray(window) ? window : [window as ReviewItem];
  const first = items[0];
  if (!first) return [];
  const hint = partsFromText(items.map((it) => it.narration).join(' '));
  for (const name of first.species ?? []) {
    const own = refs.filter((x) => x.nameKo === name && !x.part);
    const ext = refs.filter((x): x is ReviewRef & { part: RefPart } => x.nameKo === name && !!x.part);
    const hinted = pickCommons(ext.filter((x) => hint.includes(x.part)), hint, REVIEW_REFS);
    const r = hinted.length ? [...own.slice(0, Math.max(0, REVIEW_REFS - hinted.length)), ...hinted].slice(0, REVIEW_REFS)
      : [...own, ...pickCommons(ext, hint, REVIEW_REFS)].slice(0, REVIEW_REFS);
    if (r.length) return r;
  }
  return [];
}

/** 응답 → 다시 그릴 장면(순수) — 아는 키만, 중복 제거. */
export function parseRedo(raw: unknown, keys: ReadonlySet<string>): Array<{ key: string; reason: string; severity: number }> {
  const arr = Array.isArray((raw as { redo?: unknown } | null)?.redo) ? (raw as { redo: unknown[] }).redo : [];
  const out: Array<{ key: string; reason: string; severity: number }> = [];
  for (const x of arr) {
    const r = x as { key?: unknown; reason?: unknown; severity?: unknown } | null;
    const key = typeof r?.key === 'string' ? r.key.trim() : '';
    if (!keys.has(key) || out.some((o) => o.key === key)) continue;
    const reason = typeof r?.reason === 'string' ? r.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    const sev = Math.min(3, Math.max(1, Math.round(Number(r?.severity) || 2)));
    out.push({ key, reason: reason || '검토 지적(사유 없음)', severity: sev });
  }
  return out;
}

/**
 * 리뷰어 부품 — 정하람 역할 프롬프트·기억을 system 에 싣고 표준 모델(비전)로. 버스가 있으면 오피스에 '작업 중'으로 띄운다.
 * activity: 정하람 activity.log 한 줄(운영만 — 테스트는 이 부품을 쓰지 않는다).
 */
export function sceneReviewer(o: { bus?: EventBus; llm?: VisionJSON; activity?: (line: string) => void; vision?: boolean } = {}): SceneReviewFn {
  const llm: VisionJSON = o.llm ?? ((model, system, user, opts) => microJSON(model, system, user, opts));
  return async ({ items, title, signal, refs }): Promise<ReviewVerdict | null> => {
    const role = staffRole(REVIEWER);
    const vision = (o.vision ?? visionCapable()) && items.some((it) => it.still);
    const end = o.bus && role ? (emitStaffSpawn(o.bus, role, stdModel()), staffOfficeStart(o.bus, role, { summary: '롱폼 장면 검토' })) : () => {};
    const keys = new Set(items.map((it) => it.key));
    const found: Array<{ key: string; reason: string; severity: number }> = [];
    let answered = 0;
    let checked = 0;
    try {
      // 비전: 스틸이 있는 장면만 8장씩(실물 대조용 사진이 있으면 앞에 REVIEW_REFS 장 + 장면 나머지), 스틸 없는 장면은 글로 한 번 더. 글 검토: 40장면씩.
      const withStill = vision ? items.filter((it) => it.still) : [];
      const textOnly = vision ? items.filter((it) => !it.still) : [...items];
      const chunks: Array<{ items: ReviewItem[]; vision: boolean; refs: ReviewRef[] }> = [];
      for (let i = 0; i < withStill.length;) {
        const r = chunkRefs(withStill.slice(i, i + REVIEW_CHUNK - REVIEW_REFS), refs ?? []);
        const n = REVIEW_CHUNK - r.length;
        chunks.push({ items: withStill.slice(i, i + n), vision: true, refs: r });
        i += n;
      }
      for (let i = 0; i < textOnly.length; i += REVIEW_TEXT_CHUNK) chunks.push({ items: textOnly.slice(i, i + REVIEW_TEXT_CHUNK), vision: false, refs: [] });
      for (const c of chunks) {
        if (signal?.aborted) break;
        const p = reviewPrompt(c.items, { vision: c.vision, limit: Math.min(REVIEW_MAX, c.vision ? 4 : REVIEW_MAX), ...(title ? { title } : {}), ...(c.refs.length ? { refs: c.refs.map((x) => (x.part ? { nameKo: x.nameKo, part: x.part } : x.nameKo)) } : {}) });
        const system = role ? staffSystem(role, p.system) : p.system;
        const raw = await llm<{ redo?: unknown }>(stdModel(), system, p.user, {
          maxOutputTokens: 900, ...(signal ? { signal } : {}), ...(c.vision ? { visionPaths: [...c.refs.map((x) => x.file), ...c.items.map((it) => it.still!)] } : {}),
        }).catch(() => null);
        checked += c.items.length;
        if (!raw) continue;
        answered++;
        for (const r of parseRedo(raw, keys)) if (!found.some((f) => f.key === r.key)) found.push(r);
      }
      if (!answered) return null;
      // 심각도순(같으면 영상 순서) 상위 REVIEW_MAX.
      const order = new Map(items.map((it, i) => [it.key, i]));
      const redo = found.sort((a, b) => b.severity - a.severity || order.get(a.key)! - order.get(b.key)!).slice(0, REVIEW_MAX);
      const summary = `롱폼 장면 ${checked}개 검토 → 다시 그릴 장면 ${redo.length}개${redo.length ? `(${redo.map((r) => r.key).join(', ')})` : ''}`;
      o.activity?.(`[롱폼 검토] ${title ? `${title.slice(0, 24)} — ` : ''}${summary}`);
      if (o.bus) staffSay(o.bus, REVIEWER, summary);
      return { redo: redo.map(({ key, reason }) => ({ key, reason })), mode: vision ? 'vision' : 'text', checked, ...(answered < chunks.length ? { note: `검토 묶음 ${chunks.length - answered}/${chunks.length}개 응답 없음` } : {}) };
    } finally { end(); }
  };
}
