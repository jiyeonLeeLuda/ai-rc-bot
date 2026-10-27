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

/**
 * 클락션 PCM 합성 (24kHz/16bit/mono — 로봇의 tts.chunk 재생 포맷과 동일).
 * 실제 차 경적은 이중 톤이라 420Hz+508Hz 사인파를 섞는다. "빵! 빵—!" 2연타.
 * 10ms 어택/감쇠 엔벨로프로 클릭 노이즈 제거.
 */
function synthHornPcm(): Buffer {
  const SR = 24000;
  // 체감 음량 극대화: 3배 과증폭 후 하드 클리핑 → 사각파에 가까운 파형.
  // RMS가 사인파 대비 ~3dB+ 커지고 배음이 생겨 1W 스피커에서 훨씬 크게,
  // 그리고 더 "경적답게" 들린다. (풀스케일 사인도 작다는 실청 피드백 반영)
  const AMP = 3.0 * 32767;
  const CLIP = 32767;
  const tone = (ms: number): number[] => {
    const n = Math.floor((SR * ms) / 1000);
    const env = Math.floor(SR * 0.01); // 10ms
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let s = Math.sin(2 * Math.PI * 420 * t) + Math.sin(2 * Math.PI * 508 * t);
      const e = Math.min(1, i / env, (n - 1 - i) / env);
      const v = Math.round(s * 0.5 * AMP * e);
      out[i] = Math.max(-CLIP, Math.min(CLIP, v));
    }
    return out;
  };
  const silence = (ms: number): number[] => new Array(Math.floor((SR * ms) / 1000)).fill(0);
  const samples = [...tone(260), ...silence(90), ...tone(420)];
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}
const HORN_PCM = synthHornPcm();

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
    await this.voice.speak(face, '주행모드 시작', 'cool');
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
    // 진짜 경적 파형(이중 톤 PCM) 먼저 → 이어서 멘트 TTS. 로봇은 도착 순서대로 재생.
    this.voice.playPcm(face, HORN_PCM);
    await this.voice.speak(face, '배달왔어요!', 'happy');
  }
}
