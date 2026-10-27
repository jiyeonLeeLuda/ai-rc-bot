/**
 * SceneService — 로봇 2대(스타키+차량)를 함께 연출하는 "장면" 오케스트레이터.
 *
 * ReactionService가 로봇 1대의 sequence 재생이라면, 씬은 여러 로봇에 걸친
 * 복합 연출이다. 판단은 전부 서버(여기)에 있고 로봇들은 재생만 한다(ADR-3).
 *
 * 씬 목록:
 *   drivingModeStart — 차량 착좌(state.seated true 전이) 시: 스타키가 선글라스
 *                      표정(😎)으로 "주행모드 시작합니다" 발화
 *   drivingModeEnd   — 하차 시: 중립 복귀 + "주행모드 종료"
 *   horn             — 대시보드 클락션 버튼: 차량이 모터 비프로 빵빵~ +
 *                      스타키가 "간식 배달왔어요!" 발화
 */
import { Injectable, Logger } from '@nestjs/common';
import { RobotRegistryService } from '../robot/robot-registry.service';
import { VoiceService } from '../voice/voice.service';

@Injectable()
export class SceneService {
  private readonly logger = new Logger(SceneService.name);

  constructor(
    private readonly registry: RobotRegistryService,
    private readonly voice: VoiceService,
  ) {}

  /** face 능력을 가진 로봇(스타키)을 찾는다. 없으면 undefined + 경고 로그. */
  private faceRobot(scene: string): string | undefined {
    const id = this.registry.findByCapability('face');
    if (!id) this.logger.warn(`[scene:${scene}] face 로봇 미접속 — 발화 생략`);
    return id;
  }

  /** 착좌 → 주행모드 시작 연출 */
  async drivingModeStart(): Promise<void> {
    this.logger.log('[scene] 주행모드 시작');
    const face = this.faceRobot('driving-start');
    if (!face) return;
    // 'cool'(😎)은 CoreS3 얼굴 에셋 추가 전까지 neutral 폴백 — 말풍선 😎로 보완
    await this.voice.speak(face, '😎 주행모드 시작합니다', 'cool');
  }

  /** 하차 → 주행모드 종료 연출 */
  async drivingModeEnd(): Promise<void> {
    this.logger.log('[scene] 주행모드 종료');
    const face = this.faceRobot('driving-end');
    if (!face) return;
    await this.voice.speak(face, '주행모드 종료!', 'neutral');
  }

  /**
   * 클락션: 스타키 머리 스피커(1W)로 "빵빵~" + 멘트.
   * 클락션은 탑승(주행모드) 중에만 쓰므로 스타키 스피커 전담 —
   * 차량 모터 비프는 쓰지 않는다 (펌웨어의 sound:"horn" 재생 능력은 예비로 유지).
   */
  async horn(): Promise<void> {
    this.logger.log('[scene] 클락션');
    const face = this.faceRobot('horn');
    if (!face) return;
    await this.voice.speak(face, '빵빵! 빵빵! 간식 배달왔어요!', 'happy');
  }
}
