import type { Word } from './sceneRules';

// 롱폼 시범 화면 props 타입 — src 와 remotion/longform 이 함께 쓴다(루트 tsconfig rootDir=src 라 정의는 여기 둔다).
export type LfCard =
  | { kind: 'list'; header?: string; items: string[] }
  | { kind: 'compare'; left: { label: string; items: string[] }; right: { label: string; items: string[] } }
  | { kind: 'stat'; value: number; unit?: string; label?: string }
  | { kind: 'takeaway'; lines: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'chart'; header?: string; series: Array<{ label: string; value: number }>; unit?: string };

/** 개념 도해(모션그래픽) — 세그먼트가 말하는 대상을 알아보는 모양으로 그린다. */
export type Mg =
  | { kind: 'timeline'; start: string; end: string }
  | { kind: 'thickness'; step?: number }
  | { kind: 'angle'; ok: boolean }
  | { kind: 'topview'; spread: boolean }
  | { kind: 'graft' }
  | { kind: 'budcut' }
  | { kind: 'collar' }
  | { kind: 'threecut' }
  | { kind: 'reach' }
  | { kind: 'tipbud' }
  | { kind: 'half' }
  | { kind: 'cane' }
  | { kind: 'buds' }
  | { kind: 'scaffoldPick'; step: number }
  | { kind: 'branchTypes'; step: number }
  | { kind: 'cutSpots' }
  | { kind: 'ribbon'; step?: number }
  | { kind: 'seasonSplit'; step?: number }
  | { kind: 'spurSprout'; step?: number }
  | { kind: 'pruneOrder' }
  | { kind: 'youngPersimmon'; step: number }
  | { kind: 'halfPair' }
  | { kind: 'sunHours'; step: number }
  | { kind: 'blueberrySeason'; step: number }
  | { kind: 'dontCut' }
  | { kind: 'calendarSteps' }
  // 3차 — 자막만 있던 문장의 그림(Diagrams3.tsx). step 은 이어지는 문장의 단계, v 는 잎 모양 등 변형.
  | { kind: 'hesitate' | 'leafDrop' | 'potDrop' | 'chapterMap' | 'planAhead' | 'youngAge' | 'skeleton' | 'lightAir' | 'spreadTie' | 'flushCut'
      | 'slowHeal' | 'earlyBloom' | 'twoYears' | 'calendar12' | 'headingCut' | 'lateralCut' | 'stepDown' | 'coldMorning' | 'threeYears'
      | 'scaleInsect' | 'caneCycle' | 'caneAge' | 'tapeMark' | 'spurClose' | 'fruitingWood' | 'budReveal' | 'scaffoldThick' | 'stubSprouts'
      | 'tipTrim' | 'lateWinter' | 'newPlant' | 'budCount'; step?: number; v?: string };

export type Accent = 'leaves' | 'petals' | 'snow' | 'spotlight';

export interface LfSegment {
  /** 영상이 없을 때 같은 장 클립에서 뽑은 정지 화면(패널에 띄운다). */
  still?: string;
  /** 정지 화면을 뽑을 클립의 세그먼트 id. */
  stillFrom?: string;
  /** 그 클립의 어느 지점(0~1)에서 뽑나 — 연속한 정지 화면이 같은 그림이 되지 않게. */
  stillAt?: number;
  /** 정지 화면 안 핵심 부위(0~1) — 좌표 기법(포인터 링·스포트라이트·인셋 확대창)의 입력. */
  focus?: { x: number; y: number };
  /** 편집 기법(숏폼 14종 중 하나). */
  tech?: string;
  /** 장면 등장 효과. */
  enter: 'fade' | 'slide-up' | 'wipe' | 'scale';
  /** 중간 컷 — 이 프레임부터 두 번째 클립. */
  clip2?: string;
  cutAtFrame?: number;
  accent?: Accent;
  /** 결론 예고 카드 문구. */
  teaser?: string;
  /** 상단 제목(캘리 대신 붓글씨체 글자). */
  topTitle?: string;
  /** 개념 도해 — 있으면 카드 대신 이것을 그린다. */
  mg?: Mg;
  /**
   * 문장 그림 장면 모듈 키(2026-10-22 확장점) — 장면 단계(buildScenes)가 대본 세그먼트에 채운다.
   * 렌더러는 이 키로 장면 등록표에서 컴포넌트를 찾아 그린다. 없으면 도해 없이 실촬영+자막(mg 가 있으면 mg).
   */
  scene?: string;
  /** 장면 낭독 단어 시각(장면 시작부터 초, 글자 비례 어림) — scene 이 있을 때만. 장면의 atFromWords 입력. */
  sceneWords?: Word[];
  /** 직전 세그먼트와 같은 도해 — 다시 그리지 않고 완성된 상태로 잇는다. */
  mgContinue?: boolean;
  /** 같은 그림 묶음에서 앞 세그먼트들이 쓴 프레임 — 이 세그먼트는 그 시각부터 이어 간다. */
  mgOffset?: number;
  /** 같은 그림 묶음 전체 길이(프레임) — 카메라 당김의 기준. */
  mgChainFrames?: number;
  /** 목록 카드에서 지금 말하는 항목. */
  focusItem?: number;
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  startFrame: number;
  frames: number;
  audio: string;
  /** 세로 실촬영 클립(없으면 카드 화면). */
  clip?: string;
  /** 카드 화면 배경 — 같은 장 클립의 한 장면(흐리게). */
  poster?: string;
  /** 화면에 둘 카드 — 이 세그먼트 카드, 없으면 같은 장의 직전 카드. */
  card?: LfCard;
  /** 카드가 이 세그먼트에서 새로 나왔나(등장 애니메이션). */
  cardIsNew: boolean;
  captions: Array<{ text: string; startFrame: number; endFrame: number }>;
}

export interface LfChapter { index: number; title: string; startFrame: number; frames: number; poster?: string }

// interface 가 아니라 type — Composition 은 Record<string, unknown> 에 대입되는 props 를 요구한다.
export type LongFormProps = {
  title: string;
  /** 영상 전체 필름 룩 시드. */
  lookSeed: string;
  /** 장마다 자막 움직임(숏폼 6종). */
  chapterMotions: string[];
  totalFrames: number;
  chapters: LfChapter[];
  segments: LfSegment[];
  /** 자막 강조어(키워드 팝) — 대본 keywords. 없으면 시범 전정 용어. */
  keywords?: string[];
};
