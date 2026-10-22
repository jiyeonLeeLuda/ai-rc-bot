/**
 * 리액션 테이블 — ADR-3 "데이터화된 리액션"의 구현.
 *
 * 로봇은 이 스텝 배열을 순서대로 재생하기만 한다. 판단 로직은 서버에 있다.
 * 새 리액션을 추가할 때는 이 파일에 배열만 추가하고 reaction.service.ts의
 * REACTIONS 맵에 키를 등록하면 된다.
 */
import type { SequenceStep } from '@snack-express/protocol';

// 해당 표정 1스텝 리액션들 (미러 모드용)
export const MIRROR_HAPPY: SequenceStep[] = [
  { expression: 'happy', durationMs: 1500 },
];

export const MIRROR_SURPRISED: SequenceStep[] = [
  { expression: 'surprised', durationMs: 1500 },
];

export const MIRROR_WINK: SequenceStep[] = [
  { expression: 'wink', durationMs: 1500 },
];

// 😳→💕(LED 마젠타)→😳 3스텝
export const BLOWKISS: SequenceStep[] = [
  { expression: 'shy', durationMs: 600 },
  { expression: 'love', led: { r: 255, g: 0, b: 255 }, durationMs: 800 },
  { expression: 'shy', durationMs: 500 },
];

// scared → 움찔(tilt 뒤로) → dead(X_X) 3스텝
export const BANGYA: SequenceStep[] = [
  { expression: 'scared', durationMs: 500 },
  { expression: 'scared', servo: { tilt: 120, ms: 150 }, durationMs: 600 },
  { expression: 'dead', durationMs: 1500 },
];

// surprised(👀) → dizzy 비틀(pan 좌우) → dizzy + 텍스트 "으윽" 3스텝
export const HOOK: SequenceStep[] = [
  { expression: 'surprised', durationMs: 400 },
  { expression: 'dizzy', servo: { pan: 60, ms: 200 }, durationMs: 300 },
  { expression: 'dizzy', servo: { pan: 120, ms: 200 }, text: '으윽', durationMs: 1000 },
];

// neutral + pan 60→120→90 좌우 인사 3스텝
export const WAVE: SequenceStep[] = [
  { expression: 'neutral', servo: { pan: 60, ms: 250 }, durationMs: 400 },
  { expression: 'neutral', servo: { pan: 120, ms: 250 }, durationMs: 400 },
  { expression: 'neutral', servo: { pan: 90, ms: 250 }, durationMs: 500 },
];

// love 1스텝
export const HEART: SequenceStep[] = [
  { expression: 'love', durationMs: 1500 },
];
