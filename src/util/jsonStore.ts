/**
 * JSON 파일 저장소 공용 읽기·쓰기(2026-10-26 감사) — 깨진 색인이 빈 색인으로 둔갑하지 않게.
 *
 * 종전 스토어(pieces·shorts·cardnews·longform·promises·topics·media·comments)는 읽기·파싱 실패를 전부
 * "없으면 빈 스토어"로 삼켰다. 파일이 없는 것(ENOENT, 첫 기동)과 깨진 것(반쯤 쓴 JSON·권한 오류)이 같은 길을
 * 타서, 깨진 날엔 빈 목록으로 뜬 뒤 다음 저장이 수백 편 이력을 백업 없이 덮어썼다. 게다가 정리기(janitor)가
 * 그 빈 색인을 믿고 폴더를 '고아'로 휴지통에 보낸다(3일 뒤 영구 삭제).
 *
 * 규칙:
 *  · ENOENT 만 '빈 스토어'. 그 밖의 읽기 실패·파싱 실패·모양 불일치(배열이어야 하는데 객체 등)는 '깨짐'이다.
 *  · 깨진 파일은 지우지 않고 `<이름>.corrupt-<시각>` 으로 옮겨 증거를 남기고, 크게 로그를 찍는다.
 *  · 깨짐 표시는 파일 경로 단위로 이 모듈이 기억한다 — 옮긴 뒤 다시 읽으면 ENOENT 라 빈 스토어로 보이므로,
 *    함수형 스토어(media·comments)가 다음 읽기에서 빈 목록 + 새 항목 하나로 덮어쓰는 사고를 막으려면 기억이 필요하다.
 *  · 깨진 동안 쓰기는 거부한다(writeJsonAtomic 이 던진다) — 사람이 보기 전에 뭔가가 그 자리를 채우지 않게.
 *    표시는 프로세스 수명 동안만 간다(재시작하면 원본 자리가 비어 정상 빈 스토어로 출발 — 증거는 .corrupt 에 있다).
 *  · 서버는 반드시 뜬다 — 읽기는 절대 던지지 않는다.
 *  · 쓰기는 tmp → fsync → rename(원자적 교체) + 직전 판을 `.bak` 으로(APFS 에선 복제라 공짜).
 */
import fs from 'node:fs';
import path from 'node:path';

/** 깨진 것으로 판정된 저장소 파일(절대경로) → 옮긴 증거 파일 경로('' = 옮기기 실패). */
const corrupt = new Map<string, string>();

const key = (file: string): string => path.resolve(file);

/** 이 파일이 이번 프로세스에서 깨진 것으로 판정됐나. */
export function isStoreFileCorrupt(file: string): boolean { return corrupt.has(key(file)); }

/** 깨진 저장소 목록 — 서버가 텔레그램·대시보드로 알릴 때 쓴다. */
export function corruptStoreFiles(): Array<{ file: string; quarantined: string }> {
  return [...corrupt].map(([file, quarantined]) => ({ file, quarantined }));
}

/** 테스트 전용 — 기억을 비운다. */
export function resetStoreCorruptionForTest(): void { corrupt.clear(); }

export interface JsonReadResult<T> {
  /** 읽은 값. 없거나 깨졌으면 undefined. */
  value: T | undefined;
  /** 깨짐(ENOENT 아닌 실패) — true 면 이 파일로의 쓰기는 거부된다. */
  corrupt: boolean;
}

function quarantine(file: string, label: string, why: string, move = true): void {
  const abs = key(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // 마지막 정상본(.bak)을 따로 떠 둔다(최종 검토 2026-10-26) — 재시작하면 깨짐 표시가 사라져 빈 스토어로 출발하고,
  // 그 뒤 두 번째 저장이 .bak 을 1건짜리 새 색인으로 덮는다. .corrupt 자체가 반쯤 쓴 JSON 이면 .bak 이 유일한 복구본이다.
  try {
    const bak = `${abs}.bak`;
    if (fs.existsSync(bak)) fs.copyFileSync(bak, `${bak}.pre-corrupt-${stamp}`, fs.constants.COPYFILE_FICLONE);
  } catch { /* 보존 실패는 격리를 막지 않는다 */ }
  let dst = '';
  if (move) {
    dst = `${abs}.corrupt-${stamp}`;
    try {
      for (let k = 1; fs.existsSync(dst); k++) dst = `${abs}.corrupt-${stamp}~${k}`;
      fs.renameSync(abs, dst);
    } catch (e) {
      dst = '';
      console.error(`[저장소] ⚠️ ${label} 깨진 파일을 옮기지 못함(${abs}) — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  corrupt.set(abs, dst);
  console.error(`[저장소] ⚠️⚠️ ${label} 색인이 깨졌습니다 — ${why}. ${dst ? `원본은 ${dst} 로 보관` : '원본은 제자리'}. 이번 실행 동안 이 색인 저장을 막습니다(빈 목록으로 덮어쓰기 방지). 확인 뒤 복구하고 재시작하세요.`);
}

/**
 * JSON 파일 읽기 — ENOENT 면 {value: undefined, corrupt: false}, 깨졌으면 격리 후 {undefined, true}. 던지지 않는다.
 * valid 가 false 를 내면(모양 불일치) 깨진 것으로 본다.
 */
export function readJsonFile<T>(file: string, label: string, valid: (v: unknown) => boolean = () => true): JsonReadResult<T> {
  if (corrupt.has(key(file))) return { value: undefined, corrupt: true };
  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { value: undefined, corrupt: false };
    // 읽기 오류(EIO·EACCES 등)는 내용이 깨졌다는 증거가 아니다(한 번짜리일 수 있다) — 옮기지 않고 이번 실행 동안 쓰기만 막는다.
    // 막지 않으면 부팅 때 한 번 읽는 스토어가 빈 목록으로 떠서 원본을 덮는다. 재시작하면 원본 그대로 다시 읽는다.
    quarantine(file, label, `읽기 실패: ${e instanceof Error ? e.message : String(e)}`, false);
    return { value: undefined, corrupt: true };
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) {
    quarantine(file, label, `JSON 파싱 실패(${text.length}바이트): ${e instanceof Error ? e.message : String(e)}`);
    return { value: undefined, corrupt: true };
  }
  if (!valid(v)) {
    quarantine(file, label, `모양이 다름(${v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v})`);
    return { value: undefined, corrupt: true };
  }
  return { value: v as T, corrupt: false };
}

/** 배열 색인 읽기 지름길 — 배열이 아니면 깨짐. */
export function readJsonArray<T>(file: string, label: string): JsonReadResult<T[]> {
  return readJsonFile<T[]>(file, label, Array.isArray);
}

/**
 * 원자적 쓰기 — 깨진 저장소면 던진다(호출부가 삼키든 알리든 결정). tmp 를 fsync 한 뒤 rename 해 정전·강제 종료에도
 * 반쯤 쓴 파일이 원본 자리에 오지 않는다. backup 이면 바꾸기 직전 판을 `<이름>.bak` 으로 남긴다(실패 무해).
 */
export function writeJsonAtomic(file: string, data: unknown, opts: { backup?: boolean; mode?: number } = {}): void {
  if (corrupt.has(key(file))) throw new Error(`깨진 색인이라 저장을 막았습니다(${path.basename(file)}) — 복구 뒤 재시작`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; // pid — 재시작이 겹쳐 옛 프로세스가 아직 쓰는 중이어도 서로의 임시 파일을 자르지 않게
  const fd = fs.openSync(tmp, 'w', opts.mode ?? 0o644);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (opts.backup) {
    try { if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`, fs.constants.COPYFILE_FICLONE); } catch { /* 백업 실패는 저장을 막지 않는다 */ }
  }
  fs.renameSync(tmp, file);
}
