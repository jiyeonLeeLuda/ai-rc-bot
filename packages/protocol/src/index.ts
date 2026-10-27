/**
 * 스낵 익스프레스 로봇 ↔ 게이트웨이 프로토콜 v0.
 *
 * 전송: WebSocket 1커넥션. v0은 전부 JSON 텍스트 프레임이며
 * 오디오/이미지는 base64로 싣는다. (추후 바이너리 프레임으로 승격 예정 —
 * 그때도 메시지 "종류"는 이 스키마가 정본)
 *
 * 설계 원칙(ADR-3 "데이터화된 리액션"): 로봇은 판단하지 않는다.
 * 서버가 Sequence(표정·서보·LED·사운드 스텝 배열)를 내려보내면 재생만 한다.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 0;

// ---------------------------------------------------------------------------
// 공용 어휘
// ---------------------------------------------------------------------------

/** 로봇이 렌더링할 수 있는 표정. 펌웨어의 얼굴 에셋과 1:1 대응. */
export const Expression = z.enum([
  "neutral",
  "happy",
  "surprised",
  "wink",
  "shy", // 블로우 키스 리액션 (😳→💕)
  "love",
  "scared", // 빵야 1단계
  "dead", // 빵야 마지막 X_X
  "dizzy", // 훅! @_@
  "sad",
  "sleepy",
  "cool", // 😎 선글라스 — 표정과 독립인 오버레이. sound:"glasses-off" 마커로만 벗는다
  "angry", // 😠
]);
export type Expression = z.infer<typeof Expression>;

/** 목 서보 목표 각도. 크래들 정면 = pan 90 / tilt 90 기준. */
export const ServoPose = z.object({
  pan: z.number().min(0).max(180).optional(),
  tilt: z.number().min(50).max(130).optional(),
  /** 목표각까지 이동 시간(ms). 0이면 즉시. */
  ms: z.number().int().min(0).max(5000).default(300),
});
export type ServoPose = z.infer<typeof ServoPose>;

export const LedColor = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});
export type LedColor = z.infer<typeof LedColor>;

/**
 * 리액션 1스텝. 명시된 필드만 적용하고 durationMs만큼 유지한 뒤 다음 스텝으로.
 * 예) 빵야: [scared, 움찔(tilt 뒤로), dead] 3스텝.
 */
export const SequenceStep = z.object({
  expression: Expression.optional(),
  servo: ServoPose.optional(),
  led: LedColor.optional(),
  /** 펌웨어에 내장된 효과음 id (예: "ugh", "pew") */
  sound: z.string().optional(),
  /** 화면에 띄울 짧은 텍스트(말풍선) */
  text: z.string().optional(),
  durationMs: z.number().int().min(0).max(10_000),
});
export type SequenceStep = z.infer<typeof SequenceStep>;

export const DriveCommand = z.object({
  /** 좌/우 트랙 출력. -1(후진)~1(전진) */
  left: z.number().min(-1).max(1),
  right: z.number().min(-1).max(1),
  /**
   * 이 명령의 유효 시간(ms). 차량은 만료 시 반드시 정지한다(데드맨 스위치).
   * 서버·Wi-Fi가 죽어도 폭주하지 않게 하는 안전장치이므로 생략 불가.
   */
  ttlMs: z.number().int().min(50).max(2000),
});
export type DriveCommand = z.infer<typeof DriveCommand>;

// ---------------------------------------------------------------------------
// 로봇 → 서버
// ---------------------------------------------------------------------------

export const RobotHello = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int(),
  robotId: z.string(),
  firmware: z.string(),
  /** 이 개체가 가진 능력. 차량 미연결 CoreS3는 drive가 없다. */
  capabilities: z.array(z.enum(["face", "servo", "mic", "speaker", "camera", "led", "drive"])),
});

export const RobotState = z.object({
  type: z.literal("state"),
  batteryPct: z.number().min(0).max(100).optional(),
  /** 리드 스위치 — 차량 착좌 여부 */
  seated: z.boolean().optional(),
  mode: z.enum(["idle", "listening", "speaking", "mirror", "driving"]),
});

/** 마이크 PCM 스트림 조각. 16kHz / 16bit / mono, base64. */
export const AudioChunk = z.object({
  type: z.literal("audio.chunk"),
  seq: z.number().int().min(0),
  data: z.string(),
  /** 발화 종료(VAD 또는 버튼 릴리즈) */
  final: z.boolean().default(false),
});

/** 카메라 프레임(JPEG base64). 미러 모드에서 1~2fps로 전송. */
export const CameraFrame = z.object({
  type: z.literal("camera.frame"),
  seq: z.number().int().min(0),
  width: z.number().int(),
  height: z.number().int(),
  data: z.string(),
});

export const TouchEvent = z.object({
  type: z.literal("touch"),
  zone: z.enum(["center", "forehead", "left-edge", "right-edge"]),
});

export type RobotHello = z.infer<typeof RobotHello>;
export type RobotState = z.infer<typeof RobotState>;
export type AudioChunk = z.infer<typeof AudioChunk>;
export type CameraFrame = z.infer<typeof CameraFrame>;
export type TouchEvent = z.infer<typeof TouchEvent>;

export const RobotMessage = z.discriminatedUnion("type", [
  RobotHello,
  RobotState,
  AudioChunk,
  CameraFrame,
  TouchEvent,
]);
export type RobotMessage = z.infer<typeof RobotMessage>;

// ---------------------------------------------------------------------------
// 서버 → 로봇
// ---------------------------------------------------------------------------

export const HelloAck = z.object({
  type: z.literal("hello.ack"),
  protocolVersion: z.number().int(),
  sessionId: z.string(),
});

/** 리액션 재생 명령. 로봇은 스텝을 순서대로 재생만 한다. */
export const PlaySequence = z.object({
  type: z.literal("sequence"),
  /** 같은 id가 재생 중이면 무시(중복 방지), 다른 id면 끊고 교체 */
  id: z.string(),
  steps: z.array(SequenceStep).min(1),
});

/** TTS 오디오 스트림 조각. 로봇은 도착 순서대로 스피커 재생. */
export const TtsChunk = z.object({
  type: z.literal("tts.chunk"),
  seq: z.number().int().min(0),
  data: z.string(),
  final: z.boolean().default(false),
});

/** 서버가 턴을 제어: 지금부터 마이크 열어/닫아 */
export const ListenControl = z.object({
  type: z.literal("listen"),
  action: z.enum(["start", "stop"]),
});

export const Drive = DriveCommand.extend({
  type: z.literal("drive"),
});

export type HelloAck = z.infer<typeof HelloAck>;
export type PlaySequence = z.infer<typeof PlaySequence>;
export type TtsChunk = z.infer<typeof TtsChunk>;
export type ListenControl = z.infer<typeof ListenControl>;
export type Drive = z.infer<typeof Drive>;

export const ServerMessage = z.discriminatedUnion("type", [
  HelloAck,
  PlaySequence,
  TtsChunk,
  ListenControl,
  Drive,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---------------------------------------------------------------------------
// 파싱 헬퍼
// ---------------------------------------------------------------------------

export function parseRobotMessage(raw: string): RobotMessage {
  return RobotMessage.parse(JSON.parse(raw));
}

export function parseServerMessage(raw: string): ServerMessage {
  return ServerMessage.parse(JSON.parse(raw));
}
