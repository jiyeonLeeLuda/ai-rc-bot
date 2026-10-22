/**
 * VisionService — 카메라 프레임 수신 → OpenAI Vision 표정 분류 → 미러 리액션.
 *
 * 설계 결정:
 * - 쿨다운(2.5초)으로 API 호출 빈도를 제어한다 (로봇이 1~2fps를 보내므로 필수).
 * - 음성 턴 중(VoiceService.isBusy)에는 분류를 스킵한다 (프로젝트 원칙: 음성 우선).
 * - 같은 label이 연속으로 분류되면 리액션을 중복 재생하지 않는다.
 * - OPENAI_API_KEY 없으면 프레임 카운트 로그만 (기존 스텁 동작 유지).
 */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { CameraFrame } from '@snack-express/protocol';
import { VoiceService } from '../voice/voice.service';
import { ReactionService } from '../reaction/reaction.service';

// 분류 라벨 → 리액션 이름 (null이면 아무것도 안 함)
const LABEL_TO_REACTION: Record<string, string | null> = {
  happy: 'mirror-happy',
  surprised: 'mirror-surprised',
  wink: 'mirror-wink',
  blowkiss: 'blowkiss',
  bangya: 'bangya',
  hook: 'hook',
  wave: 'wave',
  heart: 'heart',
  neutral: null,
};

const COOLDOWN_MS = 2500; // 동일 로봇 최소 분류 간격

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  private readonly frameCounts = new Map<string, number>();
  // robotId → 마지막 분류 시각 (ms timestamp)
  private readonly lastClassified = new Map<string, number>();
  // robotId → 마지막으로 분류된 label (중복 방지)
  private readonly lastLabel = new Map<string, string>();

  private readonly openai: OpenAI | null;
  private readonly visionModel: string;

  constructor(
    private readonly voice: VoiceService,
    private readonly reactions: ReactionService,
  ) {
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    } else {
      this.openai = null;
    }
    this.visionModel = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini';
  }

  /** 카메라 프레임 수신 처리. 조건을 통과하면 비동기 표정 분류를 시작. */
  handleFrame(robotId: string, frame: CameraFrame): void {
    const count = (this.frameCounts.get(robotId) ?? 0) + 1;
    this.frameCounts.set(robotId, count);

    // API 키 없으면 기존 카운트 로그만
    if (!this.openai) {
      if (count % 30 === 1) {
        this.logger.debug(
          `[${robotId}] Camera frame #${count} — ${frame.width}x${frame.height}`,
        );
      }
      return;
    }

    // 쿨다운 체크
    const now = Date.now();
    const lastTime = this.lastClassified.get(robotId) ?? 0;
    if (now - lastTime < COOLDOWN_MS) return;

    // 음성 턴 중에는 비전 분류 스킵 (음성 우선 원칙)
    if (this.voice.isBusy(robotId)) {
      this.logger.debug(`[${robotId}] 음성 턴 중 — 비전 분류 스킵`);
      return;
    }

    this.lastClassified.set(robotId, now);
    void this.classifyAndReact(robotId, frame);
  }

  /** OpenAI Vision으로 표정 분류 후 리액션 트리거. */
  private async classifyAndReact(robotId: string, frame: CameraFrame): Promise<void> {
    if (!this.openai) return;

    const start = Date.now();
    try {
      const response = await this.openai.chat.completions.create({
        model: this.visionModel,
        response_format: { type: 'json_object' },
        max_tokens: 30,
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image_url' as const,
                image_url: {
                  url: `data:image/jpeg;base64,${frame.data}`,
                  detail: 'low' as const,
                },
              },
              {
                type: 'text' as const,
                text: 'Classify the expression shown. Respond only with JSON: {"label": "happy|surprised|wink|blowkiss|bangya|hook|wave|heart|neutral"}',
              },
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{"label":"neutral"}';
      let label = 'neutral';
      try {
        const parsed = JSON.parse(raw) as { label?: string };
        label = typeof parsed.label === 'string' ? parsed.label : 'neutral';
      } catch {
        // JSON 파싱 실패 시 neutral 유지
      }

      // 유효하지 않은 라벨이면 neutral
      if (!(label in LABEL_TO_REACTION)) {
        label = 'neutral';
      }

      const elapsed = Date.now() - start;
      this.logger.debug(`[${robotId}] Vision: label=${label} (${elapsed}ms)`);

      // 같은 label 연속이면 중복 재생 스킵
      if (this.lastLabel.get(robotId) === label) return;
      this.lastLabel.set(robotId, label);

      const reactionName = LABEL_TO_REACTION[label];
      if (reactionName) {
        this.reactions.play(robotId, reactionName);
      }
    } catch (err) {
      this.logger.warn(`[${robotId}] Vision 분류 에러: ${String(err)}`);
    }
  }

  /** 로봇 연결 해제 시 상태 정리 */
  cleanup(robotId: string): void {
    this.frameCounts.delete(robotId);
    this.lastClassified.delete(robotId);
    this.lastLabel.delete(robotId);
  }
}
