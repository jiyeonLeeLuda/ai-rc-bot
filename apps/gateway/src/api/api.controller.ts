/**
 * ApiController — 대시보드용 REST API.
 *
 * 모든 엔드포인트는 /robots 아래에 있다.
 * 드라이브 명령 body는 Zod로 검증하고, 실패 시 400을 반환한다.
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DriveCommand } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';
import { ReactionService } from '../reaction/reaction.service';
import { DriveService } from '../drive/drive.service';
import { SceneService } from '../scene/scene.service';

@Controller('robots')
export class ApiController {
  constructor(
    private readonly registry: RobotRegistryService,
    private readonly reactions: ReactionService,
    private readonly drive: DriveService,
    private readonly scenes: SceneService,
  ) {}

  /**
   * POST /robots/scenes/:name — 멀티 로봇 씬 재생 (horn | driving-start | driving-end).
   * horn은 대시보드 클락션 버튼이, driving-*는 착좌 전이가 주 트리거지만
   * 하드웨어(착좌 접점) 없이도 테스트할 수 있게 REST로도 연다.
   */
  @Post('scenes/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async playScene(@Param('name') name: string): Promise<void> {
    switch (name) {
      case 'horn': return this.scenes.horn();
      case 'driving-start': return this.scenes.drivingModeStart();
      case 'driving-end': return this.scenes.drivingModeEnd();
      default: throw new BadRequestException(`Unknown scene: ${name}`);
    }
  }

  /** GET /robots — 현재 연결된 로봇 목록과 메타데이터 반환 */
  @Get()
  getRobots() {
    return this.registry.getAll();
  }

  /** POST /robots/:id/reactions/:name — 지정 리액션 재생 */
  @Post(':id/reactions/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  playReaction(@Param('id') robotId: string, @Param('name') name: string): void {
    this.reactions.play(robotId, name);
  }

  /**
   * POST /robots/:id/drive — 드라이브 명령 전달.
   * body: { left: number, right: number, ttlMs: number }
   * 스키마는 protocol의 DriveCommand zod 스키마로 검증한다.
   */
  @Post(':id/drive')
  @HttpCode(HttpStatus.NO_CONTENT)
  sendDrive(@Param('id') robotId: string, @Body() body: unknown): void {
    const result = DriveCommand.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    this.drive.send(robotId, result.data);
  }

  /**
   * POST /robots/:id/say — 텍스트를 로봇에게 말하게 하기.
   * body: { text: string }
   * TODO: OpenAI TTS 연동 시 tts.chunk 스트림으로 교체.
   * 지금은 텍스트를 말풍선 sequence step으로 대체한다.
   */
  @Post(':id/say')
  @HttpCode(HttpStatus.NO_CONTENT)
  say(@Param('id') robotId: string, @Body() body: unknown): void {
    const parsed = (body as Record<string, unknown>);
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    if (!text) {
      throw new BadRequestException('body.text is required');
    }

    this.registry.send(robotId, {
      type: 'sequence',
      id: `say-${Date.now()}`,
      steps: [{ expression: 'happy', text, durationMs: 3000 }],
    });
  }
}
