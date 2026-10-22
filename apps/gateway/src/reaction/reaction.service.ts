/**
 * ReactionService — 리액션 이름을 받아 PlaySequence를 조립하고 로봇에 전송.
 *
 * 리액션 데이터(SequenceStep 배열)는 reactions.ts에, 전송 책임은 registry에 있다.
 * 이 서비스는 두 가지를 연결하는 얇은 조율자다.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PlaySequence } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';
import {
  BANGYA,
  BLOWKISS,
  HEART,
  HOOK,
  MIRROR_HAPPY,
  MIRROR_SURPRISED,
  MIRROR_WINK,
  WAVE,
} from './reactions';
import type { SequenceStep } from '@snack-express/protocol';

// 리액션 이름 → 스텝 배열. 새 리액션은 여기에 추가한다.
const REACTIONS: Record<string, SequenceStep[]> = {
  'mirror-happy': MIRROR_HAPPY,
  'mirror-surprised': MIRROR_SURPRISED,
  'mirror-wink': MIRROR_WINK,
  blowkiss: BLOWKISS,
  bangya: BANGYA,
  hook: HOOK,
  wave: WAVE,
  heart: HEART,
};

@Injectable()
export class ReactionService {
  private readonly logger = new Logger(ReactionService.name);

  constructor(private readonly registry: RobotRegistryService) {}

  /** 지정 리액션을 로봇에 재생. 미등록 리액션이면 NotFoundException. */
  play(robotId: string, name: string): void {
    const steps = REACTIONS[name];
    if (!steps) {
      throw new NotFoundException(`Unknown reaction: ${name}`);
    }

    const message: PlaySequence = {
      type: 'sequence',
      id: `${name}-${Date.now()}`,
      steps,
    };

    const sent = this.registry.send(robotId, message);
    if (sent) {
      this.logger.log(`Reaction '${name}' sent to ${robotId}`);
    } else {
      this.logger.warn(`Reaction '${name}' not sent — robot ${robotId} offline`);
    }
  }

  /** 사용 가능한 리액션 이름 목록 */
  list(): string[] {
    return Object.keys(REACTIONS);
  }
}
