/**
 * 블로그 스킬 브릿지 — image_generate / blog_publish 를 gepa 툴로 연결.
 *
 * 원본 naver-blog-agent-web 의 Python 스킬(gpt-image-2 이미지 생성 · Playwright 네이버 임시저장)을
 * 재사용한다. run_command 의 allowlist/경로 제약(임의 실행 방지)을 **우회하지 않고**, 여기서
 * **고정 인터프리터(CONFIG.blogPython) · 고정 스크립트 경로 · 리터럴 argv** 만 spawn 한다
 * — 모델은 자유 명령 문자열을 만들 수 없고, 구조화된 인자(주제·스타일·본문)만 제공한다.
 *
 * blog_publish 는 외부(네이버)에 초안을 남기는 부작용이라 agent.ts gateWrite 가 항상 승인 게이트한다.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { sandboxDir } from '../orchestrator/shell';

export interface BlogSkillResult { ok: boolean; output: string }

const OUTPUT_CAP = 12 * 1024;
// 이미지 생성·Playwright 임시저장은 셸 분석 명령보다 오래 걸릴 수 있어 별도 타임아웃(3분).
const BLOG_TIMEOUT_MS = Math.max(CONFIG.agentShellTimeoutMs, 180_000);

/**
 * 고정 스크립트 실행 — shell:false(글로브·치환·체이닝 원천 차단), 인자는 전부 리터럴 argv,
 * 타임아웃 SIGKILL, abort 전파, 출력 하드캡. OPENAI_API_KEY 는 env 로만 주입(로그 비노출).
 */
function runScript(
  script: string, args: string[], cwd: string, signal?: AbortSignal,
): Promise<BlogSkillResult> {
  return new Promise((resolve) => {
    if (!CONFIG.blogPython) {
      resolve({ ok: false, output: '(블로그 스킬 비활성 — BLOG_PYTHON 미설정)' }); return;
    }
    const scriptPath = path.join(CONFIG.blogScriptsDir, script);
    if (!fs.existsSync(CONFIG.blogPython) || !fs.existsSync(scriptPath)) {
      resolve({ ok: false, output: `(스크립트/인터프리터 없음: ${CONFIG.blogPython} · ${scriptPath})` }); return;
    }
    if (signal?.aborted) { resolve({ ok: false, output: '(취소됨)' }); return; }
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (CONFIG.openaiApiKey) childEnv.OPENAI_API_KEY = CONFIG.openaiApiKey;
    childEnv.OPENAI_IMAGE_MODEL = CONFIG.openaiImageModel;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(CONFIG.blogPython, [scriptPath, ...args], { shell: false, cwd, signal, env: childEnv });
    } catch (e) {
      resolve({ ok: false, output: `(실행 실패: ${e instanceof Error ? e.message : String(e)})` }); return;
    }
    let out = '';
    let done = false;
    const finish = (r: BlogSkillResult): void => { if (!done) { done = true; resolve(r); } };
    const onData = (d: Buffer): void => { if (out.length < OUTPUT_CAP) out += d.toString('utf-8'); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 종료됨 */ } }, BLOG_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      finish({ ok: false, output: e.name === 'AbortError' ? '(취소됨)' : `(실행 실패: ${e.message})` });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      const body = out.slice(0, OUTPUT_CAP).trim();
      finish({ ok: code === 0, output: (body || '(출력 없음)') + (code ? `\n(exit ${code})` : '') });
    });
  });
}

// ============================== image_generate ==============================

export interface ImagePayload {
  /** 통째 draft JSON(BlogDraft, imageSlots 포함) — 있으면 --draft 로 전달. */
  draftJson?: string;
  /** 마크다운 본문/주제([IMAGE:] 마커 파싱) — --content 로 전달. */
  content?: string;
  businessType?: string;
  imageStyle: string;
  topic?: string;
  limit: number;
}

/** 툴 arg(JSON 또는 평문) → 구조화 페이로드. 순수 함수(부작용 없음) — 단위 테스트 대상. */
export function parseImagePayload(arg: string): ImagePayload {
  let o: Record<string, unknown> = {};
  const t = (arg || '').trim();
  if (t.startsWith('{')) {
    try { o = JSON.parse(t) as Record<string, unknown>; } catch { o = { content: t }; }
  } else {
    o = { content: t };
  }
  const n = Number(o.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8) : 4; // 무효·음수·0 → 기본 4, 상한 8
  const p: ImagePayload = {
    businessType: o.business_type ? String(o.business_type) : undefined,
    imageStyle: String(o.image_style ?? 'photorealistic'),
    topic: o.topic ? String(o.topic) : undefined,
    limit,
  };
  if (Array.isArray(o.imageSlots)) p.draftJson = t;             // 통째 BlogDraft
  else p.content = String(o.content ?? o.body ?? o.draft ?? t);
  return p;
}

/** 페이로드를 샌드박스 파일로 기록하고 openai_image.py argv 를 만든다(경로 인자는 전부 샌드박스 고정). */
function buildImageArgs(p: ImagePayload, cwd: string): string[] {
  const args = ['--output-dir', path.join(cwd, 'images'), '--manifest', path.join(cwd, 'image_manifest.json')];
  if (p.draftJson) {
    const df = path.join(cwd, 'draft.json');
    fs.writeFileSync(df, p.draftJson, 'utf-8');
    args.push('--draft', df);
  } else if (p.content) {
    const cf = path.join(cwd, 'draft_for_images.txt');
    fs.writeFileSync(cf, p.content, 'utf-8');
    args.push('--content', cf);
  }
  if (p.businessType) args.push('--business-type', p.businessType);
  args.push('--image-style', p.imageStyle);
  if (p.topic) args.push('--topic', p.topic);
  args.push('--limit', String(p.limit));
  if (!CONFIG.openaiApiKey) args.push('--dry-run'); // 키 없으면 계획만(파이프라인 차단 방지)
  return args;
}

/** image_generate 툴 실행 — 모델 arg 로 이미지 생성. 샌드박스(data/agents/<id>/workspace)에 산출. */
export async function runImageGenerate(roleId: string, arg: string, signal?: AbortSignal): Promise<string> {
  const cwd = sandboxDir(roleId);
  const args = buildImageArgs(parseImagePayload(arg), cwd);
  const r = await runScript('openai_image.py', args, cwd, signal);
  return r.output;
}

/**
 * finalize 훅용 — 완성 초안(draft.json)에서 직접 이미지 생성(모델 툴콜 경유 X, 신뢰 경로).
 * outDir 에 이미지, manifestPath 에 매니페스트를 쓴다.
 */
export async function generateImagesForDraft(
  draftJsonPath: string, outDir: string, manifestPath: string,
  opts: { businessType?: string; imageStyle?: string; topic?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<BlogSkillResult> {
  const args = ['--draft', draftJsonPath, '--output-dir', outDir, '--manifest', manifestPath,
    '--image-style', opts.imageStyle ?? 'photorealistic',
    '--limit', String(Math.min(Math.max(1, opts.limit ?? 4), 8))];
  if (opts.businessType) args.push('--business-type', opts.businessType);
  if (opts.topic) args.push('--topic', opts.topic);
  if (!CONFIG.openaiApiKey) args.push('--dry-run');
  // finalize 는 세션 dir 를 cwd 로(샌드박스 무관 — 경로는 인자로 절대지정).
  return runScript('openai_image.py', args, path.dirname(manifestPath), signal);
}

// ============================== blog_publish ==============================

export interface PublishPayload {
  /** 05_final_content.json 인라인 객체(smarteditor_text.sections/image_positions·tags) 또는 JSON 문자열. */
  finalContent?: unknown;
  /** 06_image_manifest.json 인라인 객체({images:[{file_path}]}). */
  imageManifest?: unknown;
  dryRun: boolean;
}

/** 툴 arg → 발행 페이로드. 순수 함수 — 단위 테스트 대상. */
export function parsePublishPayload(arg: string): PublishPayload {
  let o: Record<string, unknown> = {};
  const t = (arg || '').trim();
  if (t.startsWith('{')) { try { o = JSON.parse(t) as Record<string, unknown>; } catch { o = {}; } }
  return {
    finalContent: o.final_content ?? o.finalContent,
    imageManifest: o.image_manifest ?? o.imageManifest,
    dryRun: o.dry_run === true || o.dryRun === true,
  };
}

/**
 * 모델 제공 매니페스트의 이미지 file_path 를 샌드박스 하위로만 제한한다(보안 — 임의 로컬 파일이 네이버 초안으로
 * 업로드·유출되는 것 차단). run_command 의 경로 컨테인먼트(절대/상위 경로 거부)와 image_generate 의 샌드박스-전용
 * 출력과 동일한 방어. 샌드박스 밖·비문자열 file_path 는 드롭한다. 순수 함수 — 단위 테스트 대상.
 */
export function containImageManifest(
  manifest: unknown, sandbox: string,
): { manifest: Record<string, unknown>; dropped: number } {
  const src = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>) : {};
  const imgs = Array.isArray(src.images) ? src.images : [];
  const root = path.resolve(sandbox) + path.sep;
  let dropped = 0;
  const images = imgs.filter((it) => {
    const fp = it && typeof it === 'object' ? (it as Record<string, unknown>).file_path : undefined;
    if (typeof fp !== 'string' || !fp) { dropped++; return false; }
    const resolved = path.resolve(fp);
    const inside = resolved === path.resolve(sandbox) || (resolved + path.sep).startsWith(root);
    if (!inside) dropped++;
    return inside;
  });
  return { manifest: { ...src, images }, dropped };
}

/**
 * blog_publish 툴 실행 — 네이버 SmartEditor 임시저장(draft). **발행 버튼은 누르지 않는다.**
 * 현재 gepa 산출물에는 smarteditor_text(sections/image_positions) 스키마가 없어, final_content 를
 * 인라인으로 받아야 실제 저장이 가능하다(draft→smarteditor 어댑터는 후속 작업). 없으면 명확히 안내.
 * 업로드 이미지는 샌드박스 하위 경로만 허용된다(containImageManifest) — 임의 파일 유출 방지.
 */
export async function runBlogPublish(roleId: string, arg: string, signal?: AbortSignal): Promise<string> {
  const p = parsePublishPayload(arg);
  if (!p.finalContent) {
    return '(blog_publish: final_content 필요 — draft→smarteditor 어댑터 미구현. '
      + '{"final_content":{smarteditor_text:{title,sections,image_positions},tags}, "image_manifest":{images:[{file_path}]}} 형태로 전달하거나 어댑터를 먼저 구현하세요.)';
  }
  const cwd = sandboxDir(roleId);
  const finalPath = path.join(cwd, '05_final_content.json');
  const manifestPath = path.join(cwd, '06_image_manifest.json');
  // 업로드 이미지는 샌드박스 하위 경로만 허용 — 모델이 임의 파일경로를 넣어도 유출 불가.
  const { manifest: safeManifest, dropped } = containImageManifest(p.imageManifest ?? { images: [] }, cwd);
  fs.writeFileSync(finalPath, JSON.stringify(p.finalContent, null, 2), 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify(safeManifest, null, 2), 'utf-8');
  const hasSession = !!CONFIG.naverSessionFile && fs.existsSync(CONFIG.naverSessionFile);
  const args = ['--final-content', finalPath, '--image-manifest', manifestPath, '--run-dir', cwd];
  if (CONFIG.naverSessionFile) args.push('--session-file', CONFIG.naverSessionFile);
  args.push('--headless');
  if (p.dryRun || !hasSession) args.push('--dry-run'); // 세션 없으면 실제 접속 안 함
  const r = await runScript('naver_publish.py', args, cwd, signal);
  const note = dropped ? `\n(주의: 샌드박스 밖 이미지 ${dropped}건 제외 — 업로드 이미지는 샌드박스 하위만 허용)` : '';
  return r.output + note;
}
