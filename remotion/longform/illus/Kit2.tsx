// 키트 2 — 장면 자동화용 한 곳 가져오기(barrel). 장면 파일은 이 모듈 하나만 import 한다.
// 새 부품(화분·단면·손·식물·재기·소품·땅 단면·안전 라벨·박자)은 ./k2/* 에, 기존 키트 부품은 그대로 다시 내보낸다.
export { Kit2Defs } from './k2/defs';
export { DONE, CastShadow, useAppear, mixHex } from './k2/common';
export { Planter, PotSection, potSection, planterGeom, LAYER_COLORS, type PotMaterial, type PotView, type PotLayer, type LayerMaterial } from './k2/pots';
export { Hand, HAND_GRIP, handGrip, type HandPose } from './k2/hands';
export { RootBall, Shrub, Seedling, Fruit, Berry } from './k2/plants';
export { Ruler, DimensionLine, Gauge, RangeBar, type GaugeKind } from './k2/measure';
export { Sack, sackMouth, PourStream, WaterDrops, WaterStream, Trowel, WateringCan, Fertilizer, Mulch, Stake } from './k2/props';
export { SoilSection, soilHole, type SoilLayer } from './k2/ground';
export { SafeLabel } from './k2/labels';
export * from './sceneUtil';
// 기존 키트(세밀화) — 가지·잎·나무·정원사·가위 등. (Kit 의 Pot 은 납작한 옛 화분이라 내보내지 않는다 → Planter 를 쓴다.)
export { Branch, Leaf, Bud, Ground, Gardener, GloveHand, Shears, Saw, ProcTree, MiniTree, Coin, WoodSection, CollarJoint, Chips, C, useGrow,
  leavesAlong, leavesOnTwig, leafCluster, type LeafShape } from './Kit';
export { pointAt, type P } from './geom';
export { Draw, Label, Badge, Arrow, Callout, clamp } from '../diagramParts';
export { INK, ACCENT, LEAF, MUTED } from '../InfoPanel';
export { RED, WOOD, GREY } from '../diagramParts';
/** 팔레트 — 글자·강조색. 그림 재료색은 부품이 정한다. */
export const PAL = { ink: '#f6f1e7', accent: '#e8b04b', leaf: '#8fc28a', red: '#e8735f', muted: 'rgba(246,241,231,.62)', water: '#8fc4e8', soil: '#5a4130' } as const;
