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

// 끄덕/승인 — 눈이 O K 로 변신 (sound 마커 "eyes-ok"는 펌웨어 EyeFX가 처리)
// 서보 셸 장착 전이라 고개 연기 대신 눈으로 말한다. 끝나면 자동 복귀.
export const NOD: SequenceStep[] = [
  { expression: 'happy', sound: 'eyes-ok', text: 'OK!', durationMs: 1800 },
];

// 도리도리/거절 — 눈이 N O 로 변신
export const SHAKE_NO: SequenceStep[] = [
  { expression: 'sad', sound: 'eyes-no', text: '안 돼요', durationMs: 1800 },
];

// 화남 — angry + 미세 떨림(pan) + 부들부들
export const ANGRY: SequenceStep[] = [
  { expression: 'angry', text: '부들부들', servo: { pan: 86, ms: 80 }, durationMs: 150 },
  { servo: { pan: 94, ms: 80 }, durationMs: 150 },
  { servo: { pan: 86, ms: 80 }, durationMs: 150 },
  { servo: { pan: 94, ms: 80 }, durationMs: 150 },
  { expression: 'angry', servo: { pan: 90, ms: 120 }, durationMs: 1200 },
];

// 깔깔 웃음 — happy + 고개 들썩 + ㅋㅋㅋ
export const LAUGH: SequenceStep[] = [
  { expression: 'happy', text: 'ㅋㅋㅋㅋ', servo: { tilt: 80, ms: 140 }, durationMs: 220 },
  { servo: { tilt: 100, ms: 140 }, durationMs: 220 },
  { servo: { tilt: 80, ms: 140 }, durationMs: 220 },
  { servo: { tilt: 100, ms: 140 }, durationMs: 220 },
  { expression: 'happy', servo: { tilt: 90, ms: 160 }, durationMs: 800 },
];

// 엉엉 — sad + 고개 푹 + 흑흑
export const CRY: SequenceStep[] = [
  { expression: 'sad', servo: { tilt: 70, ms: 400 }, durationMs: 700 },
  { expression: 'sad', text: '흑흑...', durationMs: 1500 },
  { servo: { tilt: 90, ms: 400 }, durationMs: 500 },
];

// 꾸벅 졸기 — sleepy + 고개가 천천히 떨어졌다 화들짝
export const DOZE: SequenceStep[] = [
  { expression: 'sleepy', servo: { tilt: 75, ms: 1200 }, durationMs: 1500 },
  { expression: 'sleepy', text: '쿨쿨...', servo: { tilt: 65, ms: 800 }, durationMs: 1200 },
  { expression: 'surprised', text: '헉 깼다!', servo: { tilt: 95, ms: 150 }, durationMs: 900 },
  { expression: 'neutral', servo: { tilt: 90, ms: 200 }, durationMs: 300 },
];

// 두리번 — 눈이 커졌다(👀) 작아졌다 두 번 (pan 살피기는 서보 셸 장착 후 효과)
export const LOOK_AROUND: SequenceStep[] = [
  { expression: 'surprised', sound: 'eyes-big', servo: { pan: 65, ms: 400 }, durationMs: 650 },
  { sound: 'eyes-small', servo: { pan: 115, ms: 400 }, durationMs: 650 },
  { sound: 'eyes-big', servo: { pan: 90, ms: 300 }, durationMs: 650 },
  { sound: 'eyes-normal', expression: 'neutral', durationMs: 300 },
];
