/**
 * RobotGateway — 로봇과의 WebSocket 연결을 관리하는 진입점.
 *
 * path: '/robot'으로 오는 연결만 받는다. 로봇은 ESP32이므로
 * WsAdapter(raw ws)를 사용한다. 연결 후 수신하는 raw JSON을
 * parseRobotMessage로 파싱하고 메시지 종류별로 각 서비스에 위임한다.
 */
import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'ws';
import type WebSocket from 'ws';
import { parseRobotMessage } from '@snack-express/protocol';
import { RobotRegistryService } from './robot-registry.service';
import { VoiceService } from '../voice/voice.service';
import { VisionService } from '../vision/vision.service';

@WebSocketGateway({ path: '/robot' })
export class RobotGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RobotGateway.name);

  constructor(
    private readonly registry: RobotRegistryService,
    private readonly voice: VoiceService,
    private readonly vision: VisionService,
  ) {}

  /** 새 WebSocket 연결. 이 시점엔 robotId가 없으므로 hello를 기다린다. */
  handleConnection(client: WebSocket): void {
    this.logger.log('Robot socket connected (waiting for hello)');

    // NestJS WsAdapter는 socket.io 이벤트 포맷({ event, data })을 기대하지만
    // 로봇은 raw JSON을 보낸다. 소켓 레벨에서 직접 메시지를 구독한다.
    client.on('message', (raw: Buffer | string) => {
      this.handleRawMessage(client, raw.toString());
    });
  }

  /** 연결 해제. 레지스트리에서 로봇 정보를 제거한다. */
  handleDisconnect(client: WebSocket): void {
    const robotId = this.registry.getRobotIdBySocket(client);
    this.logger.log(`Robot socket disconnected: ${robotId ?? '(미등록)'}`);
    if (robotId) {
      this.voice.cleanup(robotId);
      this.vision.cleanup(robotId);
    }
    this.registry.unregister(client);
  }

  /** raw JSON 문자열을 파싱하고 메시지 종류별로 위임. */
  private handleRawMessage(client: WebSocket, raw: string): void {
    let msg;
    try {
      msg = parseRobotMessage(raw);
    } catch (err) {
      this.logger.warn(`Invalid robot message: ${String(err)}`);
      return;
    }

    switch (msg.type) {
      case 'hello': {
        // 로봇이 연결 직후 신원을 알린다. 레지스트리에 등록하고 ack 응답.
        this.registry.register(client, msg);
        this.registry.send(msg.robotId, {
          type: 'hello.ack',
          protocolVersion: msg.protocolVersion,
          sessionId: crypto.randomUUID(),
        });
        break;
      }

      case 'state': {
        const robotId = this.registry.getRobotIdBySocket(client);
        if (robotId) {
          this.logger.debug(`[${robotId}] State: mode=${msg.mode} battery=${msg.batteryPct}`);
        }
        break;
      }

      case 'audio.chunk': {
        const robotId = this.registry.getRobotIdBySocket(client);
        if (robotId) {
          this.voice.handleChunk(robotId, msg);
        }
        break;
      }

      case 'camera.frame': {
        const robotId = this.registry.getRobotIdBySocket(client);
        if (robotId) {
          this.vision.handleFrame(robotId, msg);
        }
        break;
      }

      case 'touch': {
        const robotId = this.registry.getRobotIdBySocket(client);
        this.logger.log(`[${robotId ?? '?'}] Touch: zone=${msg.zone}`);
        // TODO: 터치 zone에 따른 리액션 트리거
        break;
      }
    }
  }
}
