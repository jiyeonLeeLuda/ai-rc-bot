/**
 * mock-robot — 실물 M5Stack CoreS3 없이 게이트웨이를 개발·테스트하기 위한 가짜 로봇.
 *
 * 설계 원칙:
 *  - 프로토콜 스키마(@snack-express/protocol)를 그대로 사용 — 타입 중복 금지.
 *  - stdin 한 줄 = 한 명령. 재접속 루프는 내장.
 *  - "로봇이 된 것처럼" 콘솔 출력 — 서버 메시지를 의미 있게 렌더링.
 */

import * as readline from "readline";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
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

// `a` 명령의 기본 발화 텍스트
const DEFAULT_UTTERANCE = "안녕 스타키, 오늘 기분 어때?";

// audio.chunk 한 조각의 최대 크기 (raw PCM 바이트). 16kHz/16bit = 초당 32,000바이트 → 약 1초 분량.
const CHUNK_SIZE = 32_000;

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

// TTS 수신 집계 (서버 → 로봇 방향)
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
// 음성 합성 (macOS say + afconvert)
// ---------------------------------------------------------------------------

/**
 * macOS `say` + `afconvert`를 사용해 텍스트를 16kHz/16bit/mono PCM으로 변환한 뒤,
 * CHUNK_SIZE 단위로 분할한 Buffer 배열을 반환한다.
 *
 * say/afconvert를 사용할 수 없는 환경(비 macOS 등)에서는 null을 반환하며,
 * 호출부에서 더미 데이터로 폴백한다.
 */
function synthesizeVoice(text: string): Buffer[] | null {
  const aiffPath = "/tmp/mock-voice.aiff";
  const wavPath = "/tmp/mock-voice.wav";

  // 1단계: say로 음성 합성 (Yuna = 한국어 보이스)
  let sayResult = spawnSync("say", ["-v", "Yuna", text, "-o", aiffPath], {
    encoding: "buffer",
  });

  if (sayResult.status !== 0) {
    // Yuna 보이스가 없으면 기본 보이스로 재시도
    bot("⚠️  Yuna 보이스 없음 — 기본 보이스로 재시도");
    sayResult = spawnSync("say", [text, "-o", aiffPath], {
      encoding: "buffer",
    });
  }

  if (sayResult.status !== 0 || !existsSync(aiffPath)) {
    bot("⚠️  say 명령 실패 — 더미 PCM으로 폴백");
    return null;
  }

  // 2단계: afconvert로 16kHz/16bit/mono WAV 변환
  const convertResult = spawnSync(
    "afconvert",
    [aiffPath, "-o", wavPath, "-d", "LEI16@16000", "-c", "1", "-f", "WAVE"],
    { encoding: "buffer" }
  );

  if (convertResult.status !== 0 || !existsSync(wavPath)) {
    bot("⚠️  afconvert 실패 — 더미 PCM으로 폴백");
    return null;
  }

  // 3단계: WAV 44바이트 헤더 제거 → raw PCM → CHUNK_SIZE 단위 분할
  const wav = readFileSync(wavPath);
  // WAV 표준 헤더는 44바이트. 안전하게 실제 "data" 청크 오프셋을 찾는다.
  const pcm = stripWavHeader(wav);

  if (pcm.length === 0) {
    bot("⚠️  WAV PCM 데이터 없음 — 더미 PCM으로 폴백");
    return null;
  }

  // CHUNK_SIZE 단위로 슬라이스
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcm.length; offset += CHUNK_SIZE) {
    chunks.push(pcm.subarray(offset, offset + CHUNK_SIZE));
  }
  return chunks;
}

/**
 * WAV 버퍼에서 "data" 청크를 찾아 헤더를 제거한 raw PCM만 반환한다.
 * 못 찾으면 표준 44바이트 오프셋으로 폴백한다.
 */
function stripWavHeader(wav: Buffer): Buffer {
  // "data" 마커를 리틀엔디언 바이트로 탐색 (d=0x64, a=0x61, t=0x74, a=0x61)
  for (let i = 0; i < wav.length - 8; i++) {
    if (
      wav[i] === 0x64 &&
      wav[i + 1] === 0x61 &&
      wav[i + 2] === 0x74 &&
      wav[i + 3] === 0x61
    ) {
      // i+4 ~ i+7 : data 청크 크기(4바이트). 실제 PCM은 i+8부터 시작.
      return wav.subarray(i + 8);
    }
  }
  // 표준 44바이트 헤더로 폴백
  return wav.subarray(44);
}

// ---------------------------------------------------------------------------
// 서버 메시지 핸들러
// ---------------------------------------------------------------------------

/**
 * sequence 메시지를 스텝별로 순차 재생한다.
 * 각 스텝을 콘솔에 출력한 뒤 durationMs만큼 실제로 대기한다.
 */
async function playSequence(
  msg: Extract<ServerMessage, { type: "sequence" }>
): Promise<void> {
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
        // 서버 TTS는 24kHz/16bit PCM. 재생 길이 추정: bytes / (24000 샘플/초 × 2 바이트/샘플)
        const durationSec = (ttsByteCount / (24_000 * 2)).toFixed(1);
        bot(
          `▶ 재생 완료 (${ttsChunkCount} chunks, ${ttsByteCount} bytes, ~${durationSec}초)`
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
      capabilities: [
        "face",
        "servo",
        "mic",
        "speaker",
        "camera",
        "led",
        "drive",
      ],
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
    const trimmed = line.trim();
    if (currentSend == null) {
      bot("⚠️  아직 연결되지 않음");
      return;
    }
    // handleCommand는 async이므로 에러를 잡아 출력한다.
    void handleCommand(trimmed, currentSend).catch((err: unknown) => {
      bot(`⚠️  명령 처리 중 오류: ${err}`);
    });
  });

  rl.on("close", () => {
    bot("stdin 종료 — 프로세스를 종료합니다.");
    process.exit(0);
  });
}

/** 사용 가능한 명령어 목록을 출력한다. */
function printHelp(): void {
  console.log("");
  console.log("=".repeat(55));
  console.log(" 🤖 mock-robot 인터랙티브 모드");
  console.log("=".repeat(55));
  console.log(`  a [텍스트]  — 실제 음성 발화 (macOS say → 16kHz PCM)`);
  console.log(`               텍스트 생략 시: "${DEFAULT_UTTERANCE}"`);
  console.log("  f           — 가짜 카메라 프레임 1장 (1×1 JPEG)");
  console.log("  t           — 터치: center");
  console.log("  tf          — 터치: forehead");
  console.log("  tl          — 터치: left-edge");
  console.log("  q           — 종료");
  console.log("=".repeat(55));
  console.log("");
}

/**
 * stdin 한 줄을 해석해 적절한 RobotMessage를 전송한다.
 *
 * `a` 명령은 macOS say/afconvert로 음성을 합성하므로 async다.
 * 합성 실패 시 더미 base64로 폴백한다.
 */
async function handleCommand(
  line: string,
  send: (msg: RobotMessage) => void
): Promise<void> {
  // 첫 토큰이 명령어, 나머지가 인자
  const spaceIdx = line.indexOf(" ");
  const command = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

  switch (command) {
    case "a": {
      const text = arg !== "" ? arg : DEFAULT_UTTERANCE;

      // macOS say + afconvert로 실제 PCM 생성 시도
      const pcmChunks = synthesizeVoice(text);

      if (pcmChunks !== null) {
        // 실제 PCM을 CHUNK_SIZE 단위로 audio.chunk 전송
        const totalBytes = pcmChunks.reduce((acc, c) => acc + c.length, 0);
        const startSeq = audioSeq;

        for (let i = 0; i < pcmChunks.length; i++) {
          const isFinal = i === pcmChunks.length - 1;
          send({
            type: "audio.chunk",
            seq: audioSeq++,
            data: pcmChunks[i].toString("base64"),
            final: isFinal,
          });
        }

        bot(
          `🎙 ${pcmChunks.length} chunks (${(totalBytes / 1024).toFixed(1)} KB, '${text}') seq ${startSeq}~${audioSeq - 1}`
        );
      } else {
        // 폴백: 더미 base64 5개
        const dummyPcm = Buffer.from("MOCK_PCM_FRAME").toString("base64");
        const startSeq = audioSeq;
        for (let i = 0; i < 5; i++) {
          send({
            type: "audio.chunk",
            seq: audioSeq++,
            data: dummyPcm,
            final: i === 4,
          });
        }
        bot(
          `🎙 더미 5 chunks (폴백, seq ${startSeq}~${audioSeq - 1})`
        );
      }
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
      bot(
        `❓ 알 수 없는 명령: "${command}" — 'q' 로 종료, 나머지 명령은 시작 시 안내 참고`
      );
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

connect();
