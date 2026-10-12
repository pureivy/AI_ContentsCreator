/**
 * 원문 묘사 반영(2026-10-12 사장님 지시) — 숏폼 씬·카드뉴스 슬라이드 배경 이미지가 블로그 원문이 말한 모습을 따르게 한다.
 *
 * 실측(모과나무 삽목 편): 디렉터가 원문을 못 받아 삽수가 잎 달린 채·끝이 뭉툭하게, 확인 장면이 다 자란 나무·칼로 그려졌다.
 * 원문은 "잎이 진 뒤", "아래쪽 끝을 비스듬히", "깊은 화분", "표식"이라고 했다. 디렉터·디자이너에게 원문을 주고, 장면마다
 * 꼭 보여야 할 것(must_show)과 나오면 안 되는 것(must_not)을 원문에서만 뽑아 이미지 지시에 따로 싣는다.
 */

/** 장면별 원문 묘사 목록 — 화면에 꼭 보여야 할 것과 나오면 안 되는 것. */
export interface SceneMust { show: string[]; not: string[] }

/** 디렉터가 낸 must_show·must_not 정리(순수) — 문자열만, 짧게, 장면당 상한. 비면 undefined. */
export function parseSceneMust(raw: unknown): SceneMust | undefined {
  const r = (raw ?? {}) as { must_show?: unknown; must_not?: unknown };
  const list = (v: unknown, cap: number): string[] => (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, cap);
  const show = list(r.must_show, 4);
  const not = list(r.must_not, 3);
  return show.length || not.length ? { show, not } : undefined;
}

/** 디렉터·디자이너 지시 줄(순수) — 원문이 없으면 빈 배열(종전 동작 그대로). unit: '씬' | '슬라이드'. */
export function mustDesignerGuide(sourceBody: string | undefined, unit: '씬' | '슬라이드'): string[] {
  if (!sourceBody) return [];
  return [
    `[블로그 원문 — 화면 사실의 근거. 장면 묘사·must_show 는 이 글이 말한 모습대로]\n${sourceBody.slice(0, 3000)}`,
    `원문 묘사 반영(중요): 각 ${unit}마다 must_show(그 ${unit} 화면에 꼭 보여야 할 사실 1~4개)와 must_not(나오면 원문과 어긋나는 것 0~3개)을 적어라. `
      + '근거는 위 원문에 적힌 모습만 — 지어내지 마라. 예: 원문이 "아래쪽 끝을 비스듬히 자른다"면 그 끝이 보이는 장면의 must_show 에 "아래 끝이 사선으로 잘린 삽수", '
      + '"잎이 진 뒤 꽂는다"면 must_show "잎 없는 맨가지", must_not "잎 달린 가지". '
      + '그 사실이 화면에 보일 수 있는 장면에만 넣어라(흙에 꽂힌 뒤면 아래 끝은 안 보인다 — 그 사실은 꽂기 전 장면에).',
    '대상의 단계(중요): 각 장면이 가리키는 시점의 식물 상태로 그려라 — 삽수는 뿌리·잎 없는 짧은 맨가지이고, 묘목은 원문이 말한 나이(1년생·2년생 등)의 크기다. '
      + '원문이나 수종 크기 자료에 없는 cm·m 수치를 지어내지 마라 — 수치가 없으면 손·화분 대비 비례로 적어라. 다 자란 나무를 삽수·묘목 장면에 쓰지 마라.',
    '연장 금지: 칼·가위·톱·삽은 장면 묘사에도 쓰지 마라(자른 "결과"를 보여 주고 자르는 "동작·도구"는 그리지 않는다). 연장은 must_not 에 넣어도 된다.',
  ];
}

/** 이미지 프롬프트 블록(순수) — 장면 묘사보다 구체적인 사실을 따로 못박는다. */
export function mustPromptLines(must: SceneMust | undefined): string[] {
  const out: string[] = [];
  if (must?.show.length) out.push(`[원문 묘사 — 이 장면에 반드시 이렇게 보여야 함] ${must.show.join(' · ')}. 블로그 글이 말한 모습이다 — 바꾸거나 빠뜨리지 마라.`);
  if (must?.not.length) out.push(`[이 장면에 나오면 안 됨 — 원문과 어긋남] ${must.not.join(' · ')}.`);
  return out;
}
