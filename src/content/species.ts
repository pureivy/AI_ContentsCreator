/**
 * 수종 사전(2026-09-04) — 이미지 앵커를 LLM 기억이 아니라 표에서 가져온다.
 *
 * 경위. 1차(수종 앵커)는 종이 통째로 바뀌는 사고를 막았지만 디테일이 틀렸다 — 디렉터가 남천을
 * "손바닥 모양으로 갈라진 잎"이라고 썼는데 남천은 깃꼴겹잎이다. 2차(학명 요구)도 결국 학명 자체를
 * LLM 이 기억에서 쓰므로 같은 위험이 남는다. 이 브랜드가 다루는 수종은 26종 남짓으로 한정적이라
 * 표로 관리하는 편이 확실하다.
 *
 * 표에 있으면 표를 쓰고, 없으면 종전대로 LLM 이 쓴다(fail-open) — 표가 파이프라인을 막지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface Species {
  readonly name: string;
  readonly latin: string;
  readonly aliases?: readonly string[];
  readonly type?: string;
  readonly leaf?: string;
  readonly form?: string;
  readonly flower?: string;
  readonly fruit?: string;
  readonly note?: string;
  /** 사람이 형태 묘사를 확인했는가. 코드 동작은 안 바꾸고 표시만 한다. */
  readonly verified?: boolean;
  /** 자동 추가분(디렉터 값) — 사람이 쓴 항목과 구분한다. */
  readonly auto?: boolean;
}

let cache: Species[] | null = null;

/** data/species.yaml 로드(1회 캐시, fail-open — 파일이 없거나 깨져도 빈 목록). */
export function loadSpecies(file = path.join('data', 'species.yaml')): Species[] {
  if (cache) return cache;
  try {
    const raw = YAML.parse(fs.readFileSync(file, 'utf-8')) as { species?: Record<string, Omit<Species, 'name'>> };
    cache = Object.entries(raw?.species ?? {})
      .map(([name, v]) => ({ name, ...v }))
      .filter((s) => s.latin);
  } catch { cache = []; }
  return cache;
}

/** 테스트·재로딩용. */
export function resetSpeciesCache(): void { cache = null; }

/**
 * 키워드·주제에서 수종을 찾는다(순수 판정).
 *
 * 긴 이름을 먼저 본다 — "산수유 열매"에서 '산수유'를 찾아야지, 짧은 이름이 먼저 걸리면
 * 엉뚱한 종이 잡힌다. 별칭도 같은 규칙으로 본다("태추단감" → 감나무).
 */
export function findSpecies(text: string, list = loadSpecies()): Species | undefined {
  const t = String(text ?? '');
  if (!t.trim()) return undefined;
  const keys: Array<{ key: string; sp: Species }> = [];
  for (const sp of list) {
    keys.push({ key: sp.name, sp });
    for (const a of sp.aliases ?? []) keys.push({ key: a, sp });
  }
  keys.sort((a, b) => b.key.length - a.key.length); // 긴 이름 우선
  return keys.find((k) => t.includes(k.key))?.sp;
}

/**
 * 수종 → 이미지 앵커 문구(순수). buildSceneImagePrompt 의 subject 자리에 그대로 들어간다.
 * 형태 정보가 많을수록 길어지므로 화면에 실제로 보이는 것 위주로 추린다.
 */
export function speciesAnchor(sp: Species): string {
  const parts = [sp.type, sp.leaf, sp.form].filter(Boolean);
  return `${sp.name} — ${parts.join(', ')}`.slice(0, 200);
}

/**
 * 씬 묘사에 꽃·열매가 등장할 때만 그 정보를 덧붙인다(순수).
 * 늘 붙이면 프롬프트가 길어지고, 꽃 없는 계절 장면에 꽃이 그려질 수 있다.
 */
export function speciesSeasonalHint(sp: Species, sceneText: string): string {
  const t = String(sceneText ?? '');
  const out: string[] = [];
  if (sp.flower && /꽃|개화|봉오리|꽃눈/.test(t)) out.push(`꽃: ${sp.flower}`);
  if (sp.fruit && /열매|과실|수확|씨|종자|도토리/.test(t)) out.push(`열매: ${sp.fruit}`);
  return out.join(' · ');
}

/**
 * 디렉터가 낸 값에서 수종 이름을 뽑는다(순수).
 * subject 는 "남천 — 깃꼴겹잎, ..." 꼴이므로 구분자 앞이 이름이다. 없으면 키워드를 쓴다.
 */
export function speciesNameFrom(subject: string, keyword?: string): string {
  const head = String(subject ?? '').split(/[—\-–(]/)[0]!.trim();
  const name = head || String(keyword ?? '').trim();
  // 이름다운 것만 — 공백이 섞인 구절("9월 정원 준비")이나 지나치게 긴 것은 수종명이 아니다.
  return /^[가-힣A-Za-z]{2,12}$/.test(name) ? name : '';
}

/**
 * 앵커 문구에서 앞머리 이름을 떼어 낸다(순수).
 *
 * 디렉터가 내는 subject 는 "사계장미 — 홀수 깃꼴겹잎, …" 꼴이고, 이걸 그대로 leaf 에 저장하면
 * speciesAnchor 가 이름을 한 번 더 붙여 "사계장미 — 사계장미 — …"가 된다(2026-09-04 실측).
 * 이름이 두 번 들어간 프롬프트가 이미지 모델에 어떤 영향을 주는지는 확실치 않지만, 사람이
 * 검토할 표로서도 잎 칸에 이름이 들어 있는 건 잘못이다.
 */
export function stripSpeciesNamePrefix(name: string, leaf: string | undefined): string | undefined {
  const t = String(leaf ?? '').trim();
  if (!t) return undefined;
  const head = String(name ?? '').trim();
  if (!head) return t;
  const m = new RegExp(`^${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—–-]\\s*`).exec(t);
  return (m ? t.slice(m[0].length).trim() : t) || undefined;
}

/**
 * 새 수종을 사전에 덧붙인다(2026-09-04) — 표에 없던 종이 나오면 한 번 기록해 다음부터 재사용한다.
 *
 * 왜 자동으로 쌓는가. 표에 없으면 매 편 디렉터가 특징을 새로 써내고, 그 값이 편마다 달라진다 —
 * 같은 수종인데 영상마다 다른 잎 모양이 그려질 수 있다. 한 번 적어 두면 적어도 일관된다.
 *
 * 자동 추가분은 verified:false 와 auto:true 로 표시한다. 사람이 검토하기 전까지는 '디렉터가
 * 기억에서 쓴 값'이라는 뜻이므로, 표에 있다고 해서 검증된 것은 아니다.
 *
 * 이미 있으면 아무것도 안 한다. 쓰기 실패는 삼킨다 — 사전 갱신 때문에 영상 생성이 죽으면 안 된다.
 */
export function appendSpecies(
  entry: { name: string; latin: string; type?: string; leaf?: string; form?: string; flower?: string; fruit?: string },
  file = path.join('data', 'species.yaml'),
): boolean {
  if (!entry.name || !entry.latin) return false;
  try {
    const cur = loadSpecies(file);
    if (cur.some((s) => s.name === entry.name || s.latin === entry.latin)) return false;
    const q = (v: string): string => JSON.stringify(String(v)); // YAML 안전 인용(콜론·따옴표 포함 대비)
    const leaf = stripSpeciesNamePrefix(entry.name, entry.leaf); // "이름 — 특징"에서 이름 제거
    const lines = [
      '',
      `  ${entry.name}:`,
      `    latin: ${entry.latin}`,
      ...(entry.type ? [`    type: ${q(entry.type)}`] : []),
      ...(leaf ? [`    leaf: ${q(leaf)}`] : []),
      ...(entry.form ? [`    form: ${q(entry.form)}`] : []),
      ...(entry.flower ? [`    flower: ${q(entry.flower)}`] : []),
      ...(entry.fruit ? [`    fruit: ${q(entry.fruit)}`] : []),
      '    auto: true      # 디렉터가 기억에서 쓴 값 — 사람 검토 전',
      '    verified: false',
      '',
    ];
    fs.appendFileSync(file, lines.join('\n'), 'utf-8');
    resetSpeciesCache();
    return true;
  } catch { return false; }
}

/**
 * 이미 있는 수종에 별칭 하나를 덧붙인다(2026-09-05).
 *
 * appendSpecies 와 기계가 다르다. 저쪽은 파일 끝에 새 블록을 붙이면 그만이지만, 별칭은
 * 기존 블록 '안'을 고쳐야 한다. aliases 줄이 있으면 목록에 끼워 넣고, 없으면 latin 줄
 * 다음에 새로 만든다.
 *
 * 왜 필요한가. 사장님이 '백일홍'으로 딱지를 붙인 영상이 '배롱나무' 편에서 배제됐다. 같은
 * 나무라 학명이 겹쳐서 appendSpecies 로는 못 넣는다(학명 중복이면 건너뛴다) — 새 수종이
 * 아니라 다른 이름일 뿐이기 때문이다.
 *
 * ⚠ 부르는 쪽이 checkAlias 로 먼저 걸러야 한다. 여기서는 '이미 있나'만 본다 — 짧거나
 * 위험한 별칭인지 판정하는 것은 speciesLearn.checkAlias 의 일이다.
 */
export function appendSpeciesAlias(
  name: string,
  alias: string,
  file = path.join('data', 'species.yaml'),
): boolean {
  const nm = String(name ?? '').trim();
  const al = String(alias ?? '').trim();
  if (!nm || !al || nm === al) return false;
  try {
    const cur = loadSpecies(file);
    const sp = cur.find((s) => s.name === nm);
    if (!sp) return false;
    if (sp.name === al || (sp.aliases ?? []).includes(al)) return false;

    const text = fs.readFileSync(file, 'utf-8');
    const lines = text.split('\n');
    // 블록의 시작 — 들여쓰기 2칸에 이름 그대로
    const head = lines.findIndex((l) => l === `  ${nm}:`);
    if (head < 0) return false;
    // 블록의 끝 — 다음 수종이 시작하기 전까지
    let end = lines.length;
    for (let i = head + 1; i < lines.length; i++) {
      if (/^  \S/.test(lines[i] ?? '')) { end = i; break; }
    }
    // 자동으로 붙은 별칭에는 표시를 남긴다 — LLM 판정은 틀릴 수 있다(실측: haiku 가 '도장나무'를
    // 회양목이 아니라 참나무라 했다). 표시가 없으면 사람이 무엇을 검토해야 할지 알 수 없다.
    // 꼬리말을 괄호 안에 고정해 둔다 — 이름 목록만 파싱하면 되므로 두 번째 별칭이 붙어도
    // 꼬리말이 이름으로 빨려 들어가지 않는다.
    const mark = (prev: string, added: string): string => {
      const m = /^(.*?)\s*#\s*auto\(사람 검토 전\):\s*(.*)$/.exec(prev);
      const names = m ? `${m[2]!.trim()}, ${added}` : added;
      const body = (m ? m[1]! : prev).replace(/\s+$/, '');
      return `${body}  # auto(사람 검토 전): ${names}`;
    };
    const aliasAt = lines.findIndex((l, i) => i > head && i < end && /^    aliases:\s*\[/.test(l));
    if (aliasAt >= 0) {
      const line = lines[aliasAt]!;
      const m = /^(\s*aliases:\s*\[)([^\]]*)(\])(.*)$/.exec(line);
      if (!m) return false;
      const inner = m[2]!.trim();
      const rebuilt = `${m[1]}${inner ? `${inner}, ` : ''}${al}${m[3]}`;
      lines[aliasAt] = mark(`${rebuilt}${m[4]}`, al);
    } else {
      const latinAt = lines.findIndex((l, i) => i > head && i < end && /^    latin:/.test(l));
      const at = latinAt >= 0 ? latinAt + 1 : head + 1;
      lines.splice(at, 0, mark(`    aliases: [${al}]`, al));
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
    fs.renameSync(tmp, file); // 원자적 교체 — 쓰다 죽어도 사전이 깨지지 않는다
    resetSpeciesCache();
    return true;
  } catch { return false; }
}
