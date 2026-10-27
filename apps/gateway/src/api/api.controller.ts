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
  Sse,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { DriveCommand } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';
import { ReactionService } from '../reaction/reaction.service';
import { DriveService } from '../drive/drive.service';
import { SceneService } from '../scene/scene.service';
import { VoiceService } from '../voice/voice.service';
import { CameraService } from '../camera/camera.service';

@Controller('robots')
export class ApiController {
  constructor(
    private readonly registry: RobotRegistryService,
    private readonly reactions: ReactionService,
    private readonly drive: DriveService,
    private readonly scenes: SceneService,
    private readonly voice: VoiceService,
    private readonly camera: CameraService,
  ) {}

  /**
   * GET /robots/:id/camera/stream — FPV 카메라 SSE 스트림.
   * 로봇이 올리는 프레임을 data: URL(JPEG)로 실시간 push. 브라우저는 EventSource로 구독.
   * 탑승모드에선 스타키가 앞을 보므로 이 스트림이 1인칭 주행 뷰가 된다.
   */
  @Sse(':id/camera/stream')
  cameraStream(@Param('id') robotId: string): Observable<{ data: string }> {
    return this.camera.stream(robotId).pipe(
      map((f) => ({
        // SSE data 필드는 문자열 — JSON으로 직렬화해 보낸다.
        data: JSON.stringify({
          src: `data:image/jpeg;base64,${f.data}`,
          width: f.width,
          height: f.height,
          seq: f.seq,
          ts: f.ts,
        }),
      })),
    );
  }

  /** GET /robots/:id/camera/latest — 최신 프레임 1장 (SSE 미지원 환경 폴백). */
  @Get(':id/camera/latest')
  cameraLatest(@Param('id') robotId: string): { src: string } | { src: null } {
    const f = this.camera.getLatest(robotId);
    return f ? { src: `data:image/jpeg;base64,${f.data}` } : { src: null };
  }

  /**
   * POST /robots/:id/fpv — FPV 스트리밍 수동 토글 (착좌 센서 없이 테스트용).
   * body: { on: boolean }. sound 마커(fpv-on/off)를 로봇에 직접 보낸다.
   * 평상시엔 착좌/하차 씬이 자동 토글하지만, 하드웨어 없이 검증할 때 이걸 쓴다.
   */
  @Post(':id/fpv')
  @HttpCode(HttpStatus.NO_CONTENT)
  setFpv(@Param('id') robotId: string, @Body() body: unknown): void {
    const on = (body as Record<string, unknown>)?.on === true;
    this.registry.send(robotId, {
      type: 'sequence',
      id: `fpv-${on ? 'on' : 'off'}-${Date.now()}`,
      steps: [{ sound: on ? 'fpv-on' : 'fpv-off', durationMs: 60 }],
    });
  }

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
   * POST /robots/:id/speak — 텍스트를 로봇이 그대로 읽게 하기.
   * body: { text: string }
   * VoiceService.speak가 말풍선 sequence(즉시) + OpenAI TTS 음성(tts.chunk)을 보낸다.
   * OPENAI_API_KEY가 없으면 말풍선만 표시(무음 폴백).
   */
  @Post(':id/speak')
  @HttpCode(HttpStatus.NO_CONTENT)
  async speak(@Param('id') robotId: string, @Body() body: unknown): Promise<void> {
    const parsed = (body as Record<string, unknown>);
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    if (!text) {
      throw new BadRequestException('body.text is required');
    }
    await this.voice.speak(robotId, text);
  }

  /**
   * POST /robots/:id/chat — 로봇에게 말 걸기 (say와 다름: LLM이 답변을 생성해 발화).
   * body: { text: string }. 대화 이력은 음성 턴과 공유된다.
   */
  @Post(':id/chat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async chat(@Param('id') robotId: string, @Body() body: unknown): Promise<void> {
    const parsed = (body as Record<string, unknown>);
    const text = typeof parsed.text === 'string' ? parsed.text : '';
    if (!text) {
      throw new BadRequestException('body.text is required');
    }
    await this.voice.chat(robotId, text);
  }
}
