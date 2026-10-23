// 롱폼 시범 전용 진입점 — 숏폼 진입점(remotion/index.ts)과 분리해 숏폼 번들에 섞이지 않게 한다(사장님 지시 2026-10-19).
import { registerRoot } from 'remotion';
import { LongFormRoot } from './Root';

registerRoot(LongFormRoot);
