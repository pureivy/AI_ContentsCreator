/**
 * 위키 의미검색용 임베딩 헬퍼 — 순수 함수(코사인 유사도) + 설치 임베딩 모델 해석.
 * 실행(Ollama /api/embed)은 ollama.ts, 통합(retrieve→rerank)은 llmwiki.ts. 여기는 부작용 없음(테스트 용이).
 */
import { CONFIG } from '../config';
import type { InstalledModel } from '../llm/models';

/** 두 벡터의 코사인 유사도(-1~1). 길이 불일치는 짧은 쪽 기준, 영벡터는 0. */
export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const EMBED_NAME_RE = /embed|bge|nomic|minilm|gte|e5|mxbai|paraphrase/i;

/**
 * 사용할 임베딩 모델 해석: ① 설정값(CONFIG.embedModel)이 설치돼 있으면 그것, ② 아니면 설치 모델 중
 * 임베딩류(bge/nomic/minilm/…) 자동 선택, ③ 둘 다 없으면 null → 호출측이 휴리스틱으로 폴백.
 */
export function resolveEmbedModel(installed: InstalledModel[]): string | null {
  const want = (CONFIG.embedModel || '').trim();
  if (want) {
    const hit = installed.find((m) => m.name === want || m.name.startsWith(want + ':') || m.name.startsWith(want));
    if (hit) return hit.name;
  }
  const found = installed.find((m) => EMBED_NAME_RE.test(m.name));
  return found?.name ?? null;
}
