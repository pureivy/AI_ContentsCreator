// 비온이 스프라이트 등록(생성 — 32장 = 4계절 × 8자세, 640 webp 투명). 웹팩 자산이라 번들이 URL 로 바꾼다(public 스테이징 없음).
// 기준점(눈·입·볼·발끝, 640 좌표)은 sprites/sprites.json — 생성 뒤 얼굴(두 볼 중심·간격)을 여름 idle 에 맞춰 옮겼다.
import spring_idle from './sprites/spring_idle.webp';
import spring_wave from './sprites/spring_wave.webp';
import spring_point_left from './sprites/spring_point_left.webp';
import spring_point_right from './sprites/spring_point_right.webp';
import spring_point_up from './sprites/spring_point_up.webp';
import spring_clasp from './sprites/spring_clasp.webp';
import spring_surprised from './sprites/spring_surprised.webp';
import spring_bow from './sprites/spring_bow.webp';
import summer_idle from './sprites/summer_idle.webp';
import summer_wave from './sprites/summer_wave.webp';
import summer_point_left from './sprites/summer_point_left.webp';
import summer_point_right from './sprites/summer_point_right.webp';
import summer_point_up from './sprites/summer_point_up.webp';
import summer_clasp from './sprites/summer_clasp.webp';
import summer_surprised from './sprites/summer_surprised.webp';
import summer_bow from './sprites/summer_bow.webp';
import autumn_idle from './sprites/autumn_idle.webp';
import autumn_wave from './sprites/autumn_wave.webp';
import autumn_point_left from './sprites/autumn_point_left.webp';
import autumn_point_right from './sprites/autumn_point_right.webp';
import autumn_point_up from './sprites/autumn_point_up.webp';
import autumn_clasp from './sprites/autumn_clasp.webp';
import autumn_surprised from './sprites/autumn_surprised.webp';
import autumn_bow from './sprites/autumn_bow.webp';
import winter_idle from './sprites/winter_idle.webp';
import winter_wave from './sprites/winter_wave.webp';
import winter_point_left from './sprites/winter_point_left.webp';
import winter_point_right from './sprites/winter_point_right.webp';
import winter_point_up from './sprites/winter_point_up.webp';
import winter_clasp from './sprites/winter_clasp.webp';
import winter_surprised from './sprites/winter_surprised.webp';
import winter_bow from './sprites/winter_bow.webp';

export const SPRITE_POSES = ['idle', 'wave', 'point_left', 'point_right', 'point_up', 'clasp', 'surprised', 'bow'] as const;
export type SpritePose = (typeof SPRITE_POSES)[number];
export const SPRITES: Record<'spring' | 'summer' | 'autumn' | 'winter', Record<SpritePose, string>> = {
  spring: { idle: spring_idle, wave: spring_wave, point_left: spring_point_left, point_right: spring_point_right, point_up: spring_point_up, clasp: spring_clasp, surprised: spring_surprised, bow: spring_bow },
  summer: { idle: summer_idle, wave: summer_wave, point_left: summer_point_left, point_right: summer_point_right, point_up: summer_point_up, clasp: summer_clasp, surprised: summer_surprised, bow: summer_bow },
  autumn: { idle: autumn_idle, wave: autumn_wave, point_left: autumn_point_left, point_right: autumn_point_right, point_up: autumn_point_up, clasp: autumn_clasp, surprised: autumn_surprised, bow: autumn_bow },
  winter: { idle: winter_idle, wave: winter_wave, point_left: winter_point_left, point_right: winter_point_right, point_up: winter_point_up, clasp: winter_clasp, surprised: winter_surprised, bow: winter_bow },
};
