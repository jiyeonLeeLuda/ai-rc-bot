/**
 * VisionService — 카메라 프레임 수신 스텁.
 *
 * 현재는 프레임 카운트만 로그로 남긴다.
 * TODO: 표정 분류 모델(OpenAI Vision 또는 온디바이스)을 연동해
 *       미러 모드에서 감지된 표정 → ReactionService.play() 로 연결한다.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { CameraFrame } from '@snack-express/protocol';

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  // robotId → 수신된 총 프레임 수
  private readonly frameCounts = new Map<string, number>();

  /** 카메라 프레임 수신 처리. */
  handleFrame(robotId: string, frame: CameraFrame): void {
    const count = (this.frameCounts.get(robotId) ?? 0) + 1;
    this.frameCounts.set(robotId, count);

    // 매 30프레임마다 로그 (약 15~30초 간격)
    if (count % 30 === 1) {
      this.logger.debug(
        `[${robotId}] Camera frame #${count} — ${frame.width}x${frame.height} seq=${frame.seq}`,
      );
    }

    // TODO: 표정 분류
    //   const expression = await classifyExpression(frame.data);
    //   this.reactionService.play(robotId, `mirror-${expression}`);
  }

  /** 로봇 연결 해제 시 프레임 카운터 정리 */
  cleanup(robotId: string): void {
    this.frameCounts.delete(robotId);
  }
}
