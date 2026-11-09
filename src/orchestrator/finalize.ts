/**
 * 런 마무리 — 세션 다이제스트 + 위키 적재 + run_done. debate·org 모드가 공유.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { EventType } from '../events/types';
import type { EventBus } from '../events/bus';
import { writeDigest } from '../sessions/digest';
import type { AgentOutput } from '../sessions/digest';
import { llmWiki, slugify } from '../wiki/llmwiki';
import { approvalStore } from '../approvals/store';
import { reflectAndLearn } from './reflect';
import { clearGrounding } from './groundingLedger';
import { genId } from '../util/ids';
import type { AssetBundle } from '../output';
import { generateImagesForDraft } from '../tools/blog_skills';
import { renderHtml } from '../output/render';
import { BLOG_IMAGE_MAX } from '../output/naverBlog';
import { mergeRealFrameManifest } from '../content/blogFrames';
import { applyBlogDiagrams } from './blogDiagramsApply';
import { qaSceneImages } from './shortsSceneQa';
import { findSpecies, speciesAnchor, isYoungHero } from '../content/species';

/**
 * 완성된 blog-image-NN.png 파일명들 → 슬롯 번호(NN) 정렬 매니페스트 images 배열(순수).
 * 이미지 생성이 도중 중단(부분 실패·타임아웃)돼 매니페스트가 안 써졌을 때, 살아있는 이미지를
 * 원래 슬롯 위치(NN-1 인덱스)에 복원한다 — 번호 압축 없이(중간 슬롯 실패 시 뒤 이미지가 당겨지지 않게).
 * 실패 슬롯은 null(발행이 건너뜀). cardnews 배경 복원과 동일 원리.
 */
export function reconstructImageManifest(filenames: string[], imagesDir: string): Array<{ file_path: string } | null> {
  const re = /^blog-image-(\d{2})\.png$/;
  const nums = filenames.map((f) => re.exec(f)?.[1]).filter((n): n is string => !!n).map(Number);
  const len = nums.length ? Math.max(...nums) : 0;
  const images: Array<{ file_path: string } | null> = Array.from({ length: len }, () => null);
  for (const f of filenames) {
    const m = re.exec(f);
    if (!m) continue;
    const nb = Number(m[1]);
    if (nb >= 1 && nb <= len) images[nb - 1] = { file_path: path.join(imagesDir, f) };
  }
  return images;
}

export interface FinalPosition {
  id: string;
  name: string;
  stance: string;
  text: string;
}

export interface FinalizeArgs {
  bus: EventBus;
  topic: string;
  ceoId: string;
  ceoName: string;
  assignReason: string;
  subproblems: Array<{ id: string; text: string }>;
  /** 전문가/팀 산출물(위키·다이제스트 본문). */
  positions: FinalPosition[];
  /** 자가학습(reflect)용 개별 참여자 — org 모드는 팀이 아니라 팀원 단위로 전달. 미지정 시 positions 사용. */
  participants?: Array<{ id: string; name: string; text: string }>;
  /** verified 승격(reflect) 입력 — **토론 후** 팀 산출물(스펙 §5). 미지정 시 participants(토론 전 R0)로 폴백. */
  verifiedInputs?: Array<{ id: string; text: string }>;
  critique?: { id: string; name: string; text: string };
  deliverable: string;
  converged: boolean;
  /** 발행용 초안 자산(제목·메타·태그·SEO·렌더) — 설정 시 세션 dir 에 draft.* 로 저장. */
  assets?: AssetBundle;
  /** 이미지 디자이너가 슬롯을 확정한 런 — 초안 이미지 실생성(generateImagesForDraft) 트리거. */
  autoImages?: boolean;
  /**
   * 블로그 실촬영 컷(2026-10-02) — org 가 이미 세션 images/blog-image-01.png 로 써 둔 보관소 영상 프레임.
   * 있으면 생성은 슬롯 2번부터(02~), 매니페스트 맨 앞에 실촬영 항목(source archive_frame · ai:false)을 합친다.
   */
  realFrame?: { file: string; alt: string; mediaId: string; atSec: number; species: string; hash?: string };
  /** 설정 시 LLM Wiki 적재(Karpathy ingest)에 쓸 micro 모델. */
  ingestModel?: string;
  /** 교훈 추출(reflect)용 모델 — 미지정 시 ingestModel. 약한 micro 가 교훈 JSON 을 못 내는 변동성 보완용(standard 권장). */
  reflectModel?: string;
  /** 취소 신호 — ingest/maintain LLM 호출까지 전파. */
  signal?: AbortSignal;
}

export async function finalizeRun(a: FinalizeArgs): Promise<void> {
  // --- 발행 승인 게이트(REQUIRE_APPROVAL=1) — 위험 행동 휴먼 게이트 ---
  if (CONFIG.requireApproval) {
    const { approval, decided } = approvalStore().request({
      agent_id: a.ceoId, action_type: 'publish',
      summary: `"${a.topic}" 최종 산출물 발행`, autonomy: 2,
    });
    a.bus.emit(EventType.approval_requested, {
      approval_id: approval.id, agent_id: approval.agent_id,
      action_type: approval.action_type, summary: approval.summary, autonomy: approval.autonomy,
    });
    // 런 취소 신호로 승인을 'cancelled' 정산(2026-10-26) — 안 하면 취소된 런이 타임아웃 자동승인으로 기록되고 발행 쪽으로 흘렀다.
    const onAbort = (): void => { approvalStore().cancel(approval.id); };
    if (a.signal?.aborted) onAbort(); else a.signal?.addEventListener('abort', onAbort, { once: true });
    const decision = await decided.finally(() => a.signal?.removeEventListener('abort', onAbort));
    a.bus.emit(EventType.approval_decided, {
      approval_id: approval.id, approved: decision.approved, decided_by: decision.by, note: decision.note,
    });
    if (!decision.approved) {
      a.bus.emit(EventType.run_done, { status: 'cancelled' });
      return;
    }
  }

  // 빈 산출물 방어 — 0바이트 다이제스트·위키 오염 없이 정직하게 종료.
  if (!a.deliverable.trim()) {
    a.bus.emit(EventType.error, { message: 'CEO 종합 산출물이 비어 발행을 건너뜁니다.' });
    a.bus.emit(EventType.run_done, { status: 'error' });
    return;
  }

  const deliverableRef = genId('deliv');

  // --- 세션 다이제스트 ---
  if (CONFIG.writeSessionDigest) {
    const agentOutputs: AgentOutput[] = [
      ...a.positions.map((p) => ({ id: p.id, name: p.name, stage: 'work', text: p.text })),
      ...(a.critique ? [{ id: a.critique.id, name: a.critique.name, stage: 'critique', text: a.critique.text }] : []),
      { id: a.ceoId, name: a.ceoName, stage: 'synthesis', text: a.deliverable },
    ];
    try {
      const dir = await writeDigest({
        runId: a.bus.runId, topic: a.topic, subproblems: a.subproblems,
        modelAssignmentReason: a.assignReason, agentOutputs, deliverable: a.deliverable,
      });
      a.bus.emit(EventType.session_digest_written, { path: dir });
    } catch (e) {
      a.bus.emit(EventType.log, { message: `다이제스트 저장 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // --- 발행 초안 자산 저장 — draft.json/md/html(+image-prompts) 을 세션 dir 에. 사람이 검토·발행에 사용. ---
  if (a.assets?.files?.length) {
    try {
      const dir = path.join(CONFIG.sessionsDir, a.bus.runId);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of a.assets.files) fs.writeFileSync(path.join(dir, f.name), f.content, 'utf-8');
      a.bus.emit(EventType.log, { message: `초안 자산 저장 — ${a.assets.files.map((f) => f.name).join(', ')} (SEO ${(a.assets.meta.seoScore as number) ?? '-'}/100)` });
    } catch (e) {
      a.bus.emit(EventType.log, { message: `초안 자산 저장 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // --- 블로그 이미지 자동 생성 — 완성 초안(draft.json)의 imageSlots 를 gpt-image-2 로 생성해 세션 dir 에
  //     images/ + image_manifest.json 을 남긴다. 트리거: 이미지 디자이너가 슬롯을 확정한 런(autoImages —
  //     제작팀 image_designer 협의 스테이지) 또는 옵트인 BLOG_AUTO_IMAGE. 둘 다 아니면 기존 런 경로 불변.
  //     OPENAI_API_KEY 없으면 스크립트가 dry-run(계획만). 실패는 무해(런 종료·발행을 막지 않음). ---
  //     실촬영 컷(realFrame)만 있는 런(디자이너 실패·생성 꺼짐)도 들어온다 — 이미 뗀 실사진을 매니페스트에 올려야
  //     발행이 그 사진을 쓴다. 그때는 생성 스크립트를 부르지 않는다.
  if ((CONFIG.blogAutoImage || a.autoImages || a.realFrame) && a.assets?.files?.length && !a.signal?.aborted) {
    try {
      const dir = path.join(CONFIG.sessionsDir, a.bus.runId);
      const draftPath = path.join(dir, 'draft.json');
      const imagesDir = path.join(dir, 'images');
      const manifestPath = path.join(dir, 'image_manifest.json');
      if (fs.existsSync(draftPath)) {
        // 실촬영 컷이 슬롯 1번을 차지한다 — 생성은 2번부터, 파일 번호도 02 부터(번호를 당기면 발행이 매니페스트
        // index 로 마커에 꽂아 실촬영 자리에 생성 그림이 들어간다). 총 장수는 그대로 3(실촬영 1 + 생성 2).
        const r = (CONFIG.blogAutoImage || a.autoImages)
          ? await generateImagesForDraft(
            draftPath, imagesDir, manifestPath,
            { topic: a.topic, imageStyle: 'photorealistic', limit: BLOG_IMAGE_MAX, startIndex: a.realFrame ? 1 : 0 }, a.signal,
          )
          : { ok: true, output: '생성 이미지 없음 — 실촬영 컷만' };
        // 매니페스트 복원 — 생성이 도중 중단돼 매니페스트가 안 써졌어도 완성된 images/blog-image-NN.png 를
        // 슬롯 번호대로 살려 발행이 쓰게 한다. 없으면 부분 이미지(예: 2/3)가 전부 유실돼 텍스트만 발행되던
        // 회귀 차단(2026-07-24 실측). cardnews 배경 복원과 동일 원리.
        let recovered = 0;
        if (!fs.existsSync(manifestPath) && fs.existsSync(imagesDir)) {
          try {
            const done = fs.readdirSync(imagesDir).filter((f) => /^blog-image-\d{2}\.png$/.test(f));
            const images = reconstructImageManifest(done, imagesDir);
            recovered = images.filter(Boolean).length;
            if (recovered) fs.writeFileSync(manifestPath, JSON.stringify({ images }, null, 2), 'utf-8');
          } catch { /* 복원 실패는 무해 — 텍스트만 발행 */ }
        }
        // 블로그 AI 사진 검수(2026-11-09 사장님) — 종전엔 그린 사진을 아무도 안 봤다(으름 편: 홑잎·관목으로 그려진 채 발행).
        // 카드·숏폼과 같은 비전 검수(수종·나이·글자·원문). 틀린 장만 한 번 다시 그려 같은 파일 이름으로 바꿔 넣는다. 실패는 무해.
        if (CONFIG.blogImageQa && (CONFIG.blogAutoImage || a.autoImages) && fs.existsSync(manifestPath) && !a.signal?.aborted) {
          try {
            const man = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { images?: Array<{ index?: number; file_path?: string; error?: string } | null> };
            const slots = (JSON.parse(fs.readFileSync(draftPath, 'utf-8')) as { imageSlots?: Array<{ prompt?: string; alt?: string }> }).imageSlots ?? [];
            const imgs: Array<string | null> = slots.map(() => null);
            for (const e of man.images ?? []) {
              const i = Number(e?.index);
              if (Number.isInteger(i) && i >= 0 && i < imgs.length && e?.file_path && !e.error && fs.existsSync(e.file_path)) imgs[i] = e.file_path;
            }
            if (imgs.some(Boolean)) {
              const known = findSpecies(a.topic);
              const young = isYoungHero(a.topic);
              // 전부 틀려도 다시 그린다(2026-11-09 사장님). 판정은 qaSceneImages 가 한 장씩 따로 한다.
              const qa = await qaSceneImages({
                dir, images: imgs, scenePrompts: slots.map((x) => String(x.prompt ?? '')), preset: 'photorealistic', size: '1024x1024',
                sceneHints: slots.map((x) => String(x.alt ?? '')), signal: a.signal, retryAllBad: true,
                ...(known ? { subject: speciesAnchor(known, { young }), subjectLatin: known.latin } : {}),
                ...(young ? { subjectAge: '어린 나무(묘목)' } : {}),
              });
              let swapped = 0;
              qa.images.forEach((p, i) => { const orig = imgs[i]; if (p && orig && p !== orig) { fs.copyFileSync(p, orig); swapped++; } });
              if (qa.issues.length || swapped) a.bus.emit(EventType.log, { message: `블로그 사진 검수 — 다시 그림 ${swapped}장${qa.issues.length ? ` · ${qa.issues.slice(0, 3).join(' / ')}` : ''}` });
            }
          } catch (e) {
            a.bus.emit(EventType.log, { message: `블로그 사진 검수 실패(무해): ${e instanceof Error ? e.message : String(e)}` });
          }
        }
        // 실촬영 컷을 매니페스트 맨 앞에(index 0, source archive_frame, ai:false). 복원 매니페스트도 여기를 지난다 —
        // 복원은 표시 없이 blog-image-01.png 를 집어 오므로, 다시 표시하지 않으면 발행이 실사진에 'AI 활용'을 단다.
        if (a.realFrame && fs.existsSync(a.realFrame.file)) {
          try {
            let cur: unknown = {};
            try { cur = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* 없음 — 실촬영만 */ }
            const merged = mergeRealFrameManifest(cur, { ...a.realFrame, file_path: a.realFrame.file });
            fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2), 'utf-8');
          } catch (e) {
            a.bus.emit(EventType.log, { message: `실촬영 컷 매니페스트 합치기 실패(무해): ${e instanceof Error ? e.message : String(e)}` });
          }
        }
        // 설명 도표 2장(2026-10-12 사장님 채택) — 사진(실촬영 1 + 생성 2) 뒤에 순서·요약 도표를 본문 자리에 끼우고 파일 번호를 다시 매긴다.
        if (CONFIG.blogDiagrams && !a.signal?.aborted) {
          try {
            const dg = await applyBlogDiagrams(dir, a.assets.draft, {
              signal: a.signal, log: (m) => a.bus.emit(EventType.log, { message: m }),
            });
            if (dg) a.assets.draft = dg.draft;
          } catch (e) {
            a.bus.emit(EventType.log, { message: `설명 도표 실패(무해 — 사진만): ${e instanceof Error ? e.message : String(e)}` });
          }
        }
        // 실재 반영 재렌더(실사고 2026-08-31) — 위에서 저장한 draft.html 의 <img> 는 '이 런은 이미지를
        // 생성할 예정'이라는 **예측**(org.ts)으로 찍힌 것이라, 생성이 실패하면 없는 파일을 가리켜 미리보기가
        // 깨진다(사용자 제보: BLOG_PYTHON 이 삭제된 경로여서 openai_image.py 가 아예 안 돌았다).
        // 생성 직후 파일을 세어 슬롯 단위로 다시 그린다 — 0장이면 전부 자리표시, 2/3 이면 나머지 한 칸만 자리표시.
        const readySlots = new Set<number>();
        try {
          if (fs.existsSync(imagesDir)) {
            for (const f of fs.readdirSync(imagesDir)) {
              const mm = /^blog-image-(\d{2})\.png$/.exec(f);
              if (mm) readySlots.add(Number(mm[1]) - 1);
            }
          }
        } catch { /* 스캔 실패는 무해 — 아래 재렌더를 건너뛴다 */ }
        try {
          fs.writeFileSync(path.join(dir, 'draft.html'),
            renderHtml(a.assets.draft, { imagesReady: true, readySlots }), 'utf-8');
        } catch (e) {
          a.bus.emit(EventType.log, { message: `초안 미리보기 재렌더 실패(무해): ${e instanceof Error ? e.message : String(e)}` });
        }
        const head = r.output.split('\n')[0];
        const missing = a.assets.draft.imageSlots.length - readySlots.size;
        a.bus.emit(EventType.log, { message: `블로그 이미지 — ${head}${recovered ? ` · 매니페스트 복원 ${recovered}장(부분 실패 살림)` : ''}`
          + (missing > 0 ? ` · 미생성 ${missing}장은 자리표시로 표시(깨진 이미지 방지)` : '') });
      }
    } catch (e) {
      a.bus.emit(EventType.log, { message: `블로그 이미지 생성 실패(무해): ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // --- LLM Wiki 적재(Karpathy 패턴): 산출물 → 엔티티/개념 페이지 + index + log(compounding) ---
  if (a.ingestModel) {
    try {
      const r = await llmWiki().ingest({
        title: a.topic, content: a.deliverable, model: a.ingestModel, signal: a.signal,
        contributors: [a.ceoName, ...a.positions.map((p) => p.name)],
        sources: [`run:${a.bus.runId}`],
      });
      a.bus.emit(EventType.wiki_page_written, {
        page_id: slugify(`${a.topic} (요약)`), slug: slugify(`${a.topic} (요약)`),
        title: `${a.topic} (요약)`, category: 'source', status: 'active', stance: 'neutral', op: 'create',
      });
      // F2: ingest 가 만든 엔티티/개념 페이지마다 이벤트 emit — 자료실 위키가 실시간으로 채워지게(이전엔 요약 1건만).
      for (const slug of r.pages) {
        if (!slug) continue;
        a.bus.emit(EventType.wiki_page_written, {
          page_id: slug, slug, title: slug, category: 'concept', status: 'active', stance: 'neutral', op: 'create',
        });
      }
      a.bus.emit(EventType.log, { message: `LLM Wiki 적재 — ${r.pages.length}개 페이지(엔티티/개념) 갱신` });
      // 토론(비평→반박)을 두뇌 그래프에 1급 노드·엣지로 영속화 — 빨강 rebuts 엣지로 토론 과정 가시화.
      // (산출 개념 r.pages 로 입장 노드를 relates 연결 → 지식 그래프에 합류. 비평 노드가 입장들을 rebuts.)
      try {
        const created = await llmWiki().recordDebate({
          topic: a.topic, runId: a.bus.runId,
          critique: a.critique ? { name: a.critique.name, text: a.critique.text } : undefined,
          positions: a.positions.map((p) => ({ name: p.name, text: p.text })),
          relatesTo: r.pages,
        });
        if (created.length) {
          for (const slug of created) {
            a.bus.emit(EventType.wiki_page_written, {
              page_id: slug, slug, title: slug, category: 'debate', status: 'active', stance: 'neutral', op: 'create',
            });
          }
          a.bus.emit(EventType.log, { message: `토론 적재 — 비평·입장 ${created.length}개 노드(반박 엣지)로 두뇌 그래프에 연결` });
        }
      } catch (e) {
        a.bus.emit(EventType.log, { message: `토론 적재 실패: ${e instanceof Error ? e.message : String(e)}` });
      }
      // 토론 → 종합(overview) 증분 컴파일(2026-07-16) — 런별 토론이 pruneDebate 상한에서 증발하기 전에
      // '<topic> (종합)' 페이지로 응축. 같은 topic 재런은 같은 페이지에 갱신 누적(컴파일 1회+지속 갱신).
      try {
        const ovSlug = await llmWiki().compileDebateOverview({
          topic: a.topic, model: a.ingestModel,
          positions: a.positions.map((p) => ({ name: p.name, text: p.text })),
          critique: a.critique ? { name: a.critique.name, text: a.critique.text } : undefined,
          relatesTo: r.pages, signal: a.signal,
        });
        if (ovSlug) {
          a.bus.emit(EventType.wiki_page_written, {
            page_id: ovSlug, slug: ovSlug, title: `${a.topic} (종합)`, category: 'overview', status: 'active', stance: 'neutral', op: 'update',
          });
          a.bus.emit(EventType.log, { message: `토론 종합 컴파일 — "${a.topic} (종합)" 갱신(두뇌 영구 지식)` });
        }
      } catch (e) {
        a.bus.emit(EventType.log, { message: `토론 종합 컴파일 실패(무해): ${e instanceof Error ? e.message : String(e)}` });
      }
    } catch (e) {
      a.bus.emit(EventType.log, { message: `위키 적재 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // 자가학습(self-learning) — 참여 직원 교훈을 memory.md 에 누적(다음 런 시스템프롬프트 주입).
  // run_done 전에 **await** — lesson_learned 이벤트가 SSE 라이브로 '교훈' 카운트·활동피드에 반영되게(이전엔
  // run_done 이후 백그라운드라 스트림이 닫혀 유실). 참여자는 participants(팀원 개별) 우선 — org 모드의
  // 팀 단위 positions 로는 reflect roster 가 비어 교훈이 0이었다(F1 근본원인).
  if (a.ingestModel && CONFIG.evolveEmployees && !a.signal?.aborted) {
    try {
      const n = await reflectAndLearn(
        a.bus, a.reflectModel ?? a.ingestModel, a.topic,
        (a.participants ?? a.positions).map((p) => ({ id: p.id, name: p.name, text: p.text })),
        a.deliverable, a.signal, a.verifiedInputs,
      );
      if (n) a.bus.emit(EventType.log, { message: `자가학습 — ${n}명 교훈 누적(memory.md)` });
    } catch { /* 무해 — 학습 실패가 발행을 막지 않음 */ }
  }

  a.bus.emit(EventType.run_done, { status: 'ok', deliverable_ref: deliverableRef, ...(a.assets ? { draft_meta: a.assets.meta } : {}) });

  // 자가수선 — 끊긴 링크를 **원문 발췌가 있는 대상만** 채운다(스펙 §4). 종전 maintain 은 LLM 기억으로 스텁을 만들어
  // entity 593장 중 453장이 maintain:auto 였고 오류 스텁(주머니깍지벌레 "반날개목" 등)이 작가 그라운딩에 닿았다.
  if (a.ingestModel && !a.signal?.aborted) {
    void llmWiki().fillDanglingFromSource(a.ingestModel, { maxFill: 2, signal: a.signal })
      // 프로세스 로그에도 미러 — 위키 스텁 생성은 다음 런 그라운딩에 직접 실린다(사후 추적 필요).
      .then((m) => {
        if (!m.filled) return;
        const msg = `위키 자가수선 — 원문 근거 스텁 ${m.filled}건(근거 없는 갭 ${m.noSource}건은 미생성)`;
        console.log(`[위키] ${msg}`);
        a.bus.emit(EventType.log, { message: msg });
      })
      .catch(() => { /* 백그라운드 — 무해 */ });
  }

  // 이 런의 그라운딩 원장은 verified 승격(reflect)이 끝났으니 정리 — 다음 런과 섞이지 않게(런별 격리).
  clearGrounding(a.bus.runId);
}
