/**
 * RobotRegistryService — 연결된 로봇의 중앙 등록소.
 *
 * WebSocket 연결이 들어오면 우선 소켓만 추적하고,
 * hello 메시지를 받은 뒤 robotId와 함께 정식 등록한다.
 * 모든 서비스는 send(robotId, ServerMessage)로 로봇에 명령을 내린다.
 */
import { Injectable, Logger } from '@nestjs/common';
import type WebSocket from 'ws';
import type { ServerMessage, RobotMessage } from '@snack-express/protocol';

// hello 이후 로봇 1대에 대해 유지하는 메타데이터
export interface RobotEntry {
  ws: WebSocket;
  robotId: string;
  firmware: string;
  capabilities: Extract<RobotMessage, { type: 'hello' }>['capabilities'];
  connectedAt: Date;
  /** 마지막 state 메시지의 투영 (대시보드 표시 + seated 전이 감지용) */
  mode?: string;
  seated?: boolean;
  batteryPct?: number;
}

@Injectable()
export class RobotRegistryService {
  private readonly logger = new Logger(RobotRegistryService.name);

  // 소켓 → robotId (hello 수신 전에는 항목 없음)
  private readonly socketToId = new Map<WebSocket, string>();
  // robotId → 엔트리
  private readonly robots = new Map<string, RobotEntry>();

  /** hello 수신 시 호출. 중복 robotId는 덮어쓴다(재접속 처리). */
  register(
    ws: WebSocket,
    hello: Extract<RobotMessage, { type: 'hello' }>,
  ): void {
    const { robotId, firmware, capabilities } = hello;

    // 이미 같은 robotId로 등록된 오래된 소켓이 있으면 정리
    const existing = this.robots.get(robotId);
    if (existing && existing.ws !== ws) {
      this.socketToId.delete(existing.ws);
    }

    const entry: RobotEntry = { ws, robotId, firmware, capabilities, connectedAt: new Date() };
    this.robots.set(robotId, entry);
    this.socketToId.set(ws, robotId);
    this.logger.log(`Robot registered: ${robotId} (${firmware}) caps=${capabilities.join(',')}`);
  }

  /** 연결 해제 시 호출. 해당 소켓과 연결된 로봇 정보를 제거한다. */
  unregister(ws: WebSocket): void {
    const robotId = this.socketToId.get(ws);
    if (robotId) {
      this.robots.delete(robotId);
      this.socketToId.delete(ws);
      this.logger.log(`Robot disconnected: ${robotId}`);
    }
  }

  /** robotId로 로봇에 메시지 전송. 연결이 없거나 닫혀 있으면 false 반환. */
  send(robotId: string, message: ServerMessage): boolean {
    const entry = this.robots.get(robotId);
    if (!entry) return false;

    // ws.readyState 값: OPEN=1
    if (entry.ws.readyState !== 1 /* WebSocket.OPEN */) return false;

    entry.ws.send(JSON.stringify(message));
    return true;
  }

  /** 특정 소켓의 robotId 조회 (hello 수신 전이면 undefined) */
  getRobotIdBySocket(ws: WebSocket): string | undefined {
    return this.socketToId.get(ws);
  }

  /** robotId의 capabilities 반환 (미등록 로봇이면 빈 배열) */
  getCapabilities(robotId: string): RobotEntry['capabilities'] {
    return this.robots.get(robotId)?.capabilities ?? [];
  }

  /** 지정 capability를 가진 첫 로봇의 id (예: 'face' → 스타키). 없으면 undefined. */
  findByCapability(cap: RobotEntry['capabilities'][number]): string | undefined {
    for (const entry of this.robots.values()) {
      if (entry.capabilities.includes(cap)) return entry.robotId;
    }
    return undefined;
  }

  /**
   * state 메시지 반영. 이전 seated 값을 반환해 호출자가 전이(탑승/하차)를
   * 감지할 수 있게 한다. (미등록 로봇이면 undefined)
   */
  updateState(
    robotId: string,
    state: { mode: string; seated?: boolean; batteryPct?: number },
  ): { prevSeated?: boolean } | undefined {
    const entry = this.robots.get(robotId);
    if (!entry) return undefined;
    const prevSeated = entry.seated;
    entry.mode = state.mode;
    if (state.seated !== undefined) entry.seated = state.seated;
    if (state.batteryPct !== undefined) entry.batteryPct = state.batteryPct;
    return { prevSeated };
  }

  /** REST API 용: 현재 연결된 로봇 목록 반환 */
  getAll(): Array<Omit<RobotEntry, 'ws'>> {
    return Array.from(this.robots.values()).map(({ ws: _ws, ...rest }) => rest);
  }
}
