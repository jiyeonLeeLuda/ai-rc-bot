/**
 * mock-robot — 실물 M5Stack CoreS3 없이 게이트웨이를 개발·테스트하기 위한 가짜 로봇.
 *
 * 설계 원칙:
 *  - 프로토콜 스키마(@snack-express/protocol)를 그대로 사용 — 타입 중복 금지.
 *  - stdin 한 줄 = 한 명령. 재접속 루프는 내장.
 *  - "로봇이 된 것처럼" 콘솔 출력 — 서버 메시지를 의미 있게 렌더링.
 */

import * as readline from "readline";
import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type RobotMessage,
  type ServerMessage,
} from "@snack-express/protocol";

// ---------------------------------------------------------------------------
// 환경 설정
// ---------------------------------------------------------------------------

const GATEWAY_WS_URL =
  process.env["GATEWAY_WS_URL"] ?? "ws://localhost:3001/robot";
const ROBOT_ID = process.env["ROBOT_ID"] ?? "mock-stacky";

// ---------------------------------------------------------------------------
// 표정 이모지 매핑
// ---------------------------------------------------------------------------

const EXPRESSION_EMOJI: Record<string, string> = {
  neutral: "🙂",
  happy: "😄",
  surprised: "😮",
  wink: "😉",
  shy: "😳",
  love: "😍",
  scared: "😨",
  dead: "✖_✖",
  dizzy: "@_@",
  sad: "😢",
  sleepy: "😪",
};

// ---------------------------------------------------------------------------
// 내부 상태
// ---------------------------------------------------------------------------

/** 로봇 내부 상태. 5초마다 게이트웨이에 보고한다. */
let robotMode: "idle" | "listening" | "speaking" | "mirror" | "driving" =
  "idle";
let batteryPct = 95; // 서서히 감소 시뮬레이션
let audioSeq = 0; // audio.chunk 시퀀스 번호
let cameraSeq = 0; // camera.frame 시퀀스 번호

// TTS 수신 집계
let ttsChunkCount = 0;
let ttsByteCount = 0;

// 현재 재생 중인 sequence id (중복 방지)
let playingSequenceId: string | null = null;

// drive 데드맨 스위치 타이머
let driveDeadmanTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------------

/** 현재 시각을 [HH:MM:SS] 형식으로 반환한다. */
function timestamp(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

/** 로봇 콘솔 접두어. */
function bot(msg: string): void {
  console.log(`[${timestamp()}] 🤖 ${msg}`);
}

/** Promise 기반 sleep (sequence 스텝 재생 시 사용). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1×1 픽셀 JPEG를 base64로 인코딩한 더미 이미지.
 * 실제 카메라 없이도 camera.frame 메시지를 전송할 수 있도록 사용.
 */
const DUMMY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
  "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAA" +
  "AAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA" +
  "/9oADAMBAAIRAxEAPwCwABmX/9k=";

// ---------------------------------------------------------------------------
// 서버 메시지 핸들러
// ---------------------------------------------------------------------------

/**
 * sequence 메시지를 스텝별로 순차 재생한다.
 * 각 스텝을 콘솔에 출력한 뒤 durationMs만큼 실제로 대기한다.
 */
async function playSequence(msg: Extract<ServerMessage, { type: "sequence" }>): Promise<void> {
  // 같은 id가 이미 재생 중이면 무시 (프로토콜 스펙: 중복 방지)
  if (playingSequenceId === msg.id) {
    bot(`⚠️  sequence "${msg.id}" 이미 재생 중 — 무시`);
    return;
  }
  playingSequenceId = msg.id;
  bot(`▶ sequence "${msg.id}" 시작 (${msg.steps.length}스텝)`);

  for (let i = 0; i < msg.steps.length; i++) {
    const step = msg.steps[i];
    // 다른 sequence가 끼어들어 id가 바뀌면 현재 재생을 중단한다.
    if (playingSequenceId !== msg.id) {
      bot(`⏹  sequence "${msg.id}" 교체 중단 (${i}번 스텝)`);
      return;
    }

    // 스텝 요약 줄 조립
    const parts: string[] = [`스텝${i + 1}/${msg.steps.length}`];

    if (step.expression != null) {
      const emoji = EXPRESSION_EMOJI[step.expression] ?? "❓";
      parts.push(`${emoji}(${step.expression})`);
    }
    if (step.servo != null) {
      const { pan, tilt, ms } = step.servo;
      parts.push(`서보[pan=${pan ?? "-"} tilt=${tilt ?? "-"} ${ms}ms]`);
    }
    if (step.led != null) {
      const { r, g, b } = step.led;
      parts.push(`LED(${r},${g},${b})`);
    }
    if (step.sound != null) {
      parts.push(`🔊"${step.sound}"`);
    }
    if (step.text != null) {
      parts.push(`💬"${step.text}"`);
    }
    parts.push(`${step.durationMs}ms`);

    bot(parts.join(" "));
    await sleep(step.durationMs);
  }

  bot(`✅ sequence "${msg.id}" 완료`);
  if (playingSequenceId === msg.id) {
    playingSequenceId = null;
  }
}

/**
 * 서버에서 받은 메시지를 종류에 따라 처리하고 보기 좋게 출력한다.
 */
function handleServerMessage(raw: string): void {
  let msg: ServerMessage;
  try {
    msg = parseServerMessage(raw);
  } catch (err) {
    bot(`⚠️  서버 메시지 파싱 실패: ${err}`);
    return;
  }

  switch (msg.type) {
    case "hello.ack":
      bot(`🤝 연결 확인 — 세션 ID: ${msg.sessionId}`);
      break;

    case "sequence":
      // async이지만 fire-and-forget (stdin 루프와 병렬로 재생)
      void playSequence(msg);
      break;

    case "tts.chunk":
      ttsChunkCount += 1;
      // base64 데이터 길이를 실제 바이트 수로 근사 (4자 → 3바이트)
      ttsByteCount += Math.floor((msg.data.length * 3) / 4);
      if (msg.final) {
        bot(
          `▶ 재생 완료 (${ttsChunkCount} chunks, ${ttsByteCount} bytes)`
        );
        ttsChunkCount = 0;
        ttsByteCount = 0;
      }
      break;

    case "listen":
      if (msg.action === "start") {
        robotMode = "listening";
        bot("🎤 listen start");
      } else {
        robotMode = "idle";
        bot("🎤 listen stop");
      }
      break;

    case "drive": {
      const { left, right, ttlMs } = msg;
      bot(`🛞 L=${left.toFixed(2)} R=${right.toFixed(2)} ttl=${ttlMs}ms`);

      // 기존 데드맨 타이머 초기화
      if (driveDeadmanTimer != null) {
        clearTimeout(driveDeadmanTimer);
      }
      robotMode = "driving";

      // ttlMs 경과 후 자동 정지 출력 (안전장치 시뮬레이션)
      driveDeadmanTimer = setTimeout(() => {
        robotMode = "idle";
        bot("⛔ 정지(데드맨)");
        driveDeadmanTimer = null;
      }, ttlMs);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket 연결 관리
// ---------------------------------------------------------------------------

/**
 * 게이트웨이에 WebSocket으로 연결한다.
 * 연결이 끊기면 2초 후 자동 재접속한다.
 */
function connect(): void {
  bot(`게이트웨이 접속 중... ${GATEWAY_WS_URL}`);

  const ws = new WebSocket(GATEWAY_WS_URL);

  /** 로봇 메시지를 JSON 직렬화하여 전송하는 내부 헬퍼. */
  function send(msg: RobotMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  ws.on("open", () => {
    bot("✅ 연결 성공");

    // 1) hello 전송 — 게이트웨이가 이 로봇을 인식하는 첫 메시지
    send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      robotId: ROBOT_ID,
      firmware: "mock-0.1",
      // drive 포함: 차량 탑승 상태 시뮬레이션
      capabilities: ["face", "servo", "mic", "speaker", "camera", "led", "drive"],
    });

    // 2) 5초마다 state 전송
    const stateTimer = setInterval(() => {
      // 배터리 서서히 감소 (100% → 0%)
      if (batteryPct > 0) {
        batteryPct = Math.max(0, batteryPct - 1);
      }
      send({
        type: "state",
        mode: robotMode,
        batteryPct,
        seated: true, // 차량 착좌 시뮬레이션
      });
    }, 5000);

    // 연결 종료 시 타이머 정리
    ws.once("close", () => {
      clearInterval(stateTimer);
      if (driveDeadmanTimer != null) {
        clearTimeout(driveDeadmanTimer);
        driveDeadmanTimer = null;
      }
    });
  });

  ws.on("message", (data) => {
    handleServerMessage(data.toString());
  });

  ws.on("error", (err) => {
    bot(`⚡ 오류: ${err.message}`);
  });

  ws.on("close", () => {
    bot("연결 종료 — 2초 후 재접속...");
    setTimeout(connect, 2000);
  });

  // stdin 명령을 ws 인스턴스에 연결 — 모듈 수준 변수 대신 클로저로 접근
  setupStdin(send);
}

// ---------------------------------------------------------------------------
// stdin 인터랙티브 명령
// ---------------------------------------------------------------------------

/** stdin readline 인터페이스는 프로세스 당 한 번만 생성한다. */
let stdinSetup = false;
/** 현재 활성 WebSocket의 send 함수. 재접속 시 교체된다. */
let currentSend: ((msg: RobotMessage) => void) | null = null;

/**
 * stdin readline을 초기화하고, 연결마다 send 함수를 교체한다.
 * readline 인스턴스는 재접속 루프에서 재사용된다.
 */
function setupStdin(send: (msg: RobotMessage) => void): void {
  // 현재 활성 send 교체 (재접속 시)
  currentSend = send;

  if (stdinSetup) return;
  stdinSetup = true;

  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", (line) => {
    const cmd = line.trim();
    if (currentSend == null) {
      bot("⚠️  아직 연결되지 않음");
      return;
    }
    handleCommand(cmd, currentSend);
  });

  rl.on("close", () => {
    bot("stdin 종료 — 프로세스를 종료합니다.");
    process.exit(0);
  });
}

/** 사용 가능한 명령어 목록을 출력한다. */
function printHelp(): void {
  console.log("");
  console.log("=".repeat(50));
  console.log(" 🤖 mock-robot 인터랙티브 모드");
  console.log("=".repeat(50));
  console.log("  a       — 가짜 발화 (audio.chunk ×5, final:true)");
  console.log("  f       — 가짜 카메라 프레임 1장");
  console.log("  t       — 터치: center");
  console.log("  tf      — 터치: forehead");
  console.log("  tl      — 터치: left-edge");
  console.log("  q       — 종료");
  console.log("=".repeat(50));
  console.log("");
}

/**
 * stdin 한 줄을 해석해 적절한 RobotMessage를 전송한다.
 */
function handleCommand(cmd: string, send: (msg: RobotMessage) => void): void {
  switch (cmd) {
    case "a": {
      // 가짜 발화: audio.chunk 5개 + 마지막 final:true
      // 실제 PCM 대신 짧은 base64 더미 데이터를 사용한다.
      const dummyPcm = Buffer.from("MOCK_PCM_FRAME").toString("base64");
      for (let i = 0; i < 5; i++) {
        const isFinal = i === 4;
        send({
          type: "audio.chunk",
          seq: audioSeq++,
          data: dummyPcm,
          final: isFinal,
        });
      }
      bot(`🎙 가짜 발화 전송 (5 chunks, seq ${audioSeq - 5}~${audioSeq - 1})`);
      break;
    }

    case "f": {
      // 가짜 카메라 프레임 1장 (1×1 JPEG)
      send({
        type: "camera.frame",
        seq: cameraSeq++,
        width: 1,
        height: 1,
        data: DUMMY_JPEG_BASE64,
      });
      bot(`📷 카메라 프레임 전송 (seq ${cameraSeq - 1})`);
      break;
    }

    case "t":
      send({ type: "touch", zone: "center" });
      bot("👆 터치: center");
      break;

    case "tf":
      send({ type: "touch", zone: "forehead" });
      bot("👆 터치: forehead");
      break;

    case "tl":
      send({ type: "touch", zone: "left-edge" });
      bot("👆 터치: left-edge");
      break;

    case "q":
      bot("종료합니다.");
      process.exit(0);
      break;

    case "":
      // 빈 줄은 무시
      break;

    default:
      bot(`❓ 알 수 없는 명령: "${cmd}" — 'q' 로 종료, 나머지 명령은 시작 시 안내 참고`);
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

connect();
