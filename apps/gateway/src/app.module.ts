/**
 * AppModule — 게이트웨이 전체 모듈을 조립하는 루트.
 *
 * 모듈 분리 없이 단일 모듈로 구성한다. 규모가 커지면
 * RobotModule, VoiceModule 등으로 분리를 고려한다.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RobotGateway } from './robot/robot.gateway';
import { RobotRegistryService } from './robot/robot-registry.service';
import { VoiceService } from './voice/voice.service';
import { VisionService } from './vision/vision.service';
import { ReactionService } from './reaction/reaction.service';
import { DriveService } from './drive/drive.service';
import { SceneService } from './scene/scene.service';
import { CameraService } from './camera/camera.service';
import { ApiController } from './api/api.controller';

@Module({
  imports: [
    // .env 파일을 자동으로 로드한다 (OPENAI_API_KEY, PORT 등)
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [ApiController],
  providers: [
    RobotGateway,
    RobotRegistryService,
    VoiceService,
    VisionService,
    ReactionService,
    DriveService,
    SceneService,
    CameraService,
  ],
})
export class AppModule {}
