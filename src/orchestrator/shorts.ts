/**
 * 숏폼 파이프라인 — 숏폼팀(standby)이 전담하는 전용 경로. 블로그 org 런과 무관.
 *
 * 기획(shorts_writer LLM: 훅·씬·내레이션·화면텍스트·제목3·해시태그) → 디자인(shorts_director
 * LLM: 씬별 세로 비주얼 프롬프트) → 씬 이미지(gpt-image-2, 1024×1536 세로·무텍스트) →
 * 조립(shortsRender: Pillow 자막 프레임 + TTS 내레이션 + ffmpeg 1080×1920 MP4).
 *
 * 실행 모델: 카드뉴스와 동일 — 서버가 launch 래퍼로 런 등록(오피스 뷰 연동), 프론트는 GET 폴링.
 * 직원 프롬프트는 회사 로스터(company.yaml)의 system_prompt 를 그대로 사용.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { microJSON, runAgent, extractFirstJson } from './agent';
import { getCompany } from '../agents/company-loader';
import { rolesById } from '../agents/company';
import { stripEmoji } from '../output/render';
import { shortsStore } from '../content/shorts';
import { generateImagesForDraft } from '../tools/blog_skills';
import { renderShortsVideo } from '../tools/shortsRender';
import type { ShortsScene } from '../tools/shortsRender';
import type { EventBus } from '../events/bus';

const RUNNING = new Set<string>();
export function isShortsRunning(id: string): boolean { return RUNNING.has(id); }

const PRESETS = new Set(['photorealistic', 'manhwa', 'watercolor', 'ink_wash', 'flat_design', 'retro_poster']);
const PRESET_ALIAS: Record<string, string> = {
  '사진풍': 'photorealistic', '수채화풍': 'watercolor', '플랫 일러스트': 'flat_design', '만화풍': 'manhwa',
};

const stdModel = (): string => (CONFIG.backend === 'local' ? CONFIG.tierModels.standard : CONFIG.cloudTierModels.standard);

interface Plan {
  title: string;
  titles: string[];
  scenes: ShortsScene[];
  description: string;
  hashtags: string[];
}

interface JobIO { bus?: EventBus; signal?: AbortSignal }

/** 역할 LLM 호출(JSON) — 버스가 있으면 runAgent(오피스 뷰 스폰·스트림·지표), 없으면 무음 microJSON. */
async function callRoleJSON<T>(
  io: JobIO, roleId: string, fallbackSystem: string, task: string,
  maxOutputTokens: number, emitSpawn: boolean,
): Promise<T | null> {
  const role = (() => { try { return rolesById(getCompany()).get(roleId); } catch { return undefined; } })();
  if (io.bus && role) {
    const out = await runAgent({
      bus: io.bus, role, model: stdModel(),
      task: `${task}\n\n다른 텍스트 없이 JSON만 출력하라.`,
      stage: 'work', emitSpawn, maxOutputTokens, signal: io.signal,
    });
    return extractFirstJson<T>(out.text);
  }
  return microJSON<T>(stdModel(), role?.systemPrompt || fallbackSystem, task, { maxOutputTokens, signal: io.signal });
}

/** 내레이션 위생 — 이모지·괄호 지문 제거(TTS 가 읽어버림), 길이 캡. */
function cleanNarration(s: unknown, cap = 120): string {
  return stripEmoji(String(s ?? ''))
    .replace(/[()（）[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, cap);
}

function normalizeHashtags(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [];
  const tags = arr
    .map((t) => String(t ?? '').trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  if (!tags.some((t) => t.toLowerCase() === '#shorts')) tags.push('#shorts'); // 참고 자산 규약: #shorts 필수
  return [...new Set(tags)].slice(0, 8);
}

async function planShorts(io: JobIO, topic: string, keyword: string | undefined, sourceBody: string | undefined, n: number): Promise<Plan | null> {
  const user = [
    `[주제] ${topic}`,
    keyword ? `[핵심 키워드] ${keyword}` : '',
    sourceBody ? `[블로그 초안 본문 — 핵심 1~2개만 추려 재구성하라(문장 복붙 금지, 사실·수치는 원문에 있는 것만)]\n${sourceBody.slice(0, 4000)}` : '',
    '',
    `씬 ${n}개의 유튜브 숏폼 대본을 기획하라. 씬1=훅(3패턴 중 택1), 마지막 씬=CTA.`,
    '내레이션은 TTS 낭독용: 구어체 존댓말, 숫자는 한글로("30%"→"삼십 퍼센트"), 이모지·괄호 지문 금지.',
    '본문 씬 내레이션은 반드시 2문장(합쳐서 40~65자, 낭독 6~9초) — 방법 한 문장 + 이유/효과 한 문장. 훅·CTA 씬은 1~2문장(20~40자). 총 낭독 시간 30~55초를 맞춘다.',
    'screenText 는 씬당 1줄 15자 이내 키워드 요약(비워도 됨).',
    'JSON 형식: {"title":"대표 제목","titles":["정보형","후킹형","질문형"],"scenes":[{"narration":"...","screenText":"..."}],"description":"2~3줄","hashtags":["#니치","#범용","#shorts"]}',
  ].filter(Boolean).join('\n');
  const j = await callRoleJSON<{ title?: unknown; titles?: unknown[]; scenes?: Array<{ narration?: unknown; screenText?: unknown }>; description?: unknown; hashtags?: unknown }>(
    io, 'shorts_writer', '당신은 유튜브 숏폼 작가입니다. 요청된 JSON 스키마만 출력합니다.', user, 2200, true,
  );
  if (!j || !Array.isArray(j.scenes) || !j.scenes.length) return null;
  const scenes = j.scenes.slice(0, 8).map((s) => ({
    narration: cleanNarration(s?.narration),
    screenText: stripEmoji(String(s?.screenText ?? '')).trim().slice(0, 20),
  })).filter((s) => s.narration);
  if (scenes.length < 3) return null;
  const titles = (Array.isArray(j.titles) ? j.titles : []).map((t) => stripEmoji(String(t ?? '')).trim()).filter(Boolean).slice(0, 3);
  return {
    title: stripEmoji(String(j.title ?? '')).trim().slice(0, 60) || titles[0] || topic,
    titles: titles.length ? titles : [topic],
    scenes,
    description: String(j.description ?? '').trim().slice(0, 500),
    hashtags: normalizeHashtags(j.hashtags),
  };
}

async function designScenes(io: JobIO, topic: string, plan: Plan): Promise<{ preset: string; style: string; prompts: string[] }> {
  const user = [
    `[주제] ${topic}`,
    '[씬 — 내레이션 요지]',
    ...plan.scenes.map((s, i) => `${i + 1}. ${s.narration.slice(0, 60)}${s.screenText ? ` (자막: ${s.screenText})` : ''}`),
    '',
    `각 씬의 세로(9:16) 배경 이미지 프롬프트를 설계하라. scenes 는 정확히 ${plan.scenes.length}개.`,
    '하단 25%는 자막 영역 — 핵심 피사체는 중상단 배치. 이미지 안 글자 금지.',
    'JSON 형식: {"style_preset":"photorealistic|watercolor|flat_design|manhwa","style":"모든 씬 공통 스타일 문구(팔레트·질감·조명)","scenes":[{"prompt":"장면 묘사(한국어 150자 이내)"}]}',
  ].join('\n');
  const j = await callRoleJSON<{ style_preset?: unknown; style?: unknown; scenes?: Array<{ prompt?: unknown }> }>(
    io, 'shorts_director', '당신은 숏폼 영상 디렉터입니다. 요청된 JSON 스키마만 출력합니다.', user, 1800, true,
  );
  const rawPreset = String(j?.style_preset ?? '').trim();
  const preset = PRESETS.has(rawPreset) ? rawPreset : (PRESET_ALIAS[rawPreset] ?? 'photorealistic');
  const style = String(j?.style ?? '').trim().slice(0, 200) || '밝고 깔끔한 한국 생활 사진풍, 부드러운 자연광';
  const prompts = plan.scenes.map((s, i) => {
    const p = String(j?.scenes?.[i]?.prompt ?? '').trim().slice(0, 200);
    return p || `${topic} 를 상징하는 한국 생활 장면, ${s.narration.slice(0, 30)} 분위기`;
  });
  return { preset, style, prompts };
}

/** 숏폼 생성 잡 — launch 래퍼가 버스·시그널을 주입(오피스 뷰 연동). 프론트는 GET 폴링. */
export async function runShortsJob(
  id: string,
  opts: { sourceBody?: string; sceneCount?: number; bus?: EventBus; signal?: AbortSignal } = {},
): Promise<void> {
  const store = shortsStore();
  const short = store.get(id);
  if (!short || RUNNING.has(id)) return;
  RUNNING.add(id);
  const dir = store.dirFor(id);
  const io: JobIO = { bus: opts.bus, signal: opts.signal };
  const say = (m: string): void => { console.log(`[숏폼] ${m}`); opts.bus?.emit('log', { message: m }); };
  const checkAbort = (): void => { if (opts.signal?.aborted) throw new Error('취소됨'); };
  try {
    fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
    const n = Math.min(Math.max(4, opts.sceneCount ?? 6), 8);

    // 1) 기획 — 대본(훅·씬·내레이션·자막)·제목 3후보·설명·해시태그
    store.update(id, { stage: 'planning' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'work' });
    const plan = await planShorts(io, short.topic, short.keyword, opts.sourceBody, n);
    if (!plan) throw new Error('기획 실패 — 작가 JSON 응답을 해석할 수 없습니다');
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
    say(`대본 완성 — ${plan.title.slice(0, 30)} · 씬 ${plan.scenes.length}개`);
    checkAbort();

    // 2) 디자인 — 씬별 세로 비주얼 프롬프트(전 씬 일관 스타일 + 장면 변주)
    store.update(id, {
      stage: 'designing', title: plan.title, titles: plan.titles,
      description: plan.description, hashtags: plan.hashtags,
    });
    const design = await designScenes(io, short.topic, plan);
    say(`디자인 확정 — ${design.preset} · ${design.style.slice(0, 40)}`);
    checkAbort();

    // 3) 씬 이미지 — 세로 1024×1536, 무텍스트(자막·내레이션은 렌더러가 얹음)
    store.update(id, { stage: 'rendering' });
    opts.bus?.emit('phase', { team_id: 'shorts', phase: 'integrate' });
    say(`씬 이미지 생성 시작 — gpt-image-2 세로 ${plan.scenes.length}장`);
    const bgDraft = {
      imageSlots: plan.scenes.map((s, i) => ({
        alt: s.screenText || s.narration.slice(0, 30),
        prompt: `${design.style}. ${design.prompts[i]}. 세로 화면 하단 4분의 1은 자막용 단순 여백, 핵심 피사체는 중상단`,
      })),
    };
    const bgDraftPath = path.join(dir, 'bg-draft.json');
    const bgManifestPath = path.join(dir, 'bg-manifest.json');
    fs.writeFileSync(bgDraftPath, JSON.stringify(bgDraft, null, 2), 'utf-8');
    await generateImagesForDraft(bgDraftPath, path.join(dir, 'scenes'), bgManifestPath,
      { imageStyle: design.preset, limit: plan.scenes.length, size: '1024x1536', timeoutMs: 150_000 * plan.scenes.length },
      opts.signal);
    // 슬롯 정렬 이미지 목록 — 실패 씬은 null(렌더러가 그라데이션 폴백, 순서 보존)
    let images: Array<string | null> = plan.scenes.map(() => null);
    try {
      const m = JSON.parse(fs.readFileSync(bgManifestPath, 'utf-8')) as { images?: Array<{ file_path?: string; error?: string } | null>; dry_run?: boolean };
      if (!m.dry_run) {
        images = plan.scenes.map((_, i) => {
          const im = m.images?.[i];
          const fp = im?.file_path ? String(im.file_path) : '';
          return fp && !im?.error && fs.existsSync(fp) ? fp : null;
        });
      }
    } catch { /* 전 씬 폴백 */ }
    checkAbort();

    // 4) 조립 — Pillow 자막 프레임 + TTS 내레이션 + ffmpeg 세로 MP4 + srt
    say(`영상 조립 시작 — TTS 내레이션 + ffmpeg`);
    const r = await renderShortsVideo(dir, plan.scenes, images, { signal: opts.signal });
    if (!r.ok || !r.videoPath) throw new Error(`조립 실패 — ${r.issues.join(' · ').slice(0, 250)}`);
    const fallbacks = r.issues.filter((x) => x.includes('배경 폴백')).length;

    // 캡션 파일(업로드 편의) — 제목·설명·해시태그.
    const caption = [plan.title, '', plan.description, '', plan.hashtags.join(' ')].filter((x, i) => x || i === 1 || i === 3).join('\n');
    fs.writeFileSync(path.join(dir, 'caption.txt'), caption, 'utf-8');

    store.update(id, {
      stage: 'ready', scenes: r.sceneCount, durationSec: r.durationSec, bgFallbacks: fallbacks,
      topic: plan.title || short.topic,
    });
    say(`${plan.title.slice(0, 30)} — ${r.durationSec}초 · 씬 ${r.sceneCount}개 완성${fallbacks ? ` (배경 폴백 ${fallbacks}씬)` : ''}`);
  } catch (e) {
    const msg = opts.signal?.aborted ? '취소됨' : e instanceof Error ? e.message.slice(0, 300) : String(e);
    store.update(id, { stage: 'error', error: msg });
    say(`${short.topic.slice(0, 30)} — 실패: ${msg}`);
  } finally {
    RUNNING.delete(id);
  }
}
