/**
 * DriveService — DriveCommand를 로봇에 전달.
 *
 * ttlMs는 protocol 스키마(DriveCommand.ttlMs: min 50ms, max 2000ms)가 강제한다.
 * 이 값이 만료되면 로봇 펌웨어가 자동으로 정지하는 데드맨 스위치 역할을 한다.
 * 서버 또는 Wi-Fi 장애 시에도 로봇이 폭주하지 않게 하는 안전장치이므로 생략 불가.
 */
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import type { DriveCommand } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);

  constructor(private readonly registry: RobotRegistryService) {}

  /**
   * DriveCommand를 로봇에 전송.
   * capabilities에 'drive'가 없는 로봇(차량 미연결 CoreS3)이면 거부한다.
   */
  send(robotId: string, cmd: DriveCommand): void {
    const caps = this.registry.getCapabilities(robotId);
    if (!caps.includes('drive')) {
      throw new ForbiddenException(`Robot ${robotId} does not have drive capability`);
    }

    const sent = this.registry.send(robotId, { type: 'drive', ...cmd });
    if (sent) {
      this.logger.debug(`[${robotId}] Drive: L=${cmd.left} R=${cmd.right} ttl=${cmd.ttlMs}ms`);
    } else {
      this.logger.warn(`[${robotId}] Drive command not sent — robot offline`);
    }
  }
}
