/**
 * 게이트웨이(NestJS) REST API 래퍼.
 * 환경 변수 NEXT_PUBLIC_GATEWAY_URL이 없으면 localhost:3001로 폴백한다.
 */
import type { DriveCommand } from "@snack-express/protocol";

const BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3001";

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

/** GET /robots 응답 한 항목. RobotHello의 REST 투영(projection). */
export interface Robot {
  robotId: string;
  firmware: string;
  /** RobotHello.capabilities와 동일: face | servo | mic | speaker | camera | led | drive */
  capabilities: string[];
  mode: "idle" | "listening" | "speaking" | "mirror" | "driving";
  batteryPct?: number;
  /** 리드 스위치 — 차량 착좌 여부 */
  seated?: boolean;
}

/** 지원하는 리액션 이름 목록 */
export type ReactionName =
  | "mirror-happy"
  | "mirror-surprised"
  | "mirror-wink"
  | "blowkiss"
  | "bangya"
  | "hook"
  | "wave"
  | "heart";

// ---------------------------------------------------------------------------
// API 호출
// ---------------------------------------------------------------------------

/** 연결된 로봇 목록을 조회한다. 오류 시 빈 배열 반환. */
export async function fetchRobots(): Promise<Robot[]> {
  const res = await fetch(`${BASE}/robots`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /robots failed: ${res.status}`);
  return res.json() as Promise<Robot[]>;
}

/** 지정 로봇에 리액션을 재생한다. */
export async function postReaction(
  robotId: string,
  name: ReactionName,
): Promise<void> {
  await fetch(`${BASE}/robots/${robotId}/reactions/${name}`, {
    method: "POST",
  });
}

/**
 * 드라이브 명령을 전송한다.
 * ttlMs 이내에 다음 명령이 오지 않으면 로봇은 자동으로 정지한다(데드맨 스위치).
 */
export async function postDrive(
  robotId: string,
  cmd: DriveCommand,
): Promise<void> {
  await fetch(`${BASE}/robots/${robotId}/drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
}

/** TTS: 로봇이 지정 텍스트를 읽게 한다. */
export async function postSay(robotId: string, text: string): Promise<void> {
  await fetch(`${BASE}/robots/${robotId}/say`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
