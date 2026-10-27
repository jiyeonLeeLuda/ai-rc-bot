/**
 * CameraService — 로봇 카메라 프레임을 대시보드로 중계 (FPV 주행 뷰).
 *
 * 로봇이 올리는 camera.frame(JPEG base64)을 로봇별로 보관하고, SSE 구독자에게
 * 실시간으로 밀어준다. VisionService가 같은 프레임으로 표정 분류를 하므로
 * 여기선 "최신 프레임 보관 + 스트림"만 담당한다 (관심사 분리).
 *
 * 탑승모드에선 스타키가 앞을 향하므로 이 스트림이 곧 1인칭 주행 뷰가 된다.
 */
import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type { CameraFrame } from '@snack-express/protocol';

export interface FramePayload {
  data: string; // base64 JPEG
  width: number;
  height: number;
  seq: number;
  ts: number; // 수신 시각(ms)
}

@Injectable()
export class CameraService {
  // robotId → 최신 프레임 (늦게 접속한 구독자에게 즉시 1장 보여주기 위함)
  private readonly latest = new Map<string, FramePayload>();
  // robotId → 프레임 스트림 (SSE 구독자에게 push)
  private readonly streams = new Map<string, Subject<FramePayload>>();

  /** 로봇이 올린 프레임을 보관 + 구독자에게 방송. */
  publish(robotId: string, frame: CameraFrame): void {
    const payload: FramePayload = {
      data: frame.data,
      width: frame.width,
      height: frame.height,
      seq: frame.seq,
      ts: Date.now(),
    };
    this.latest.set(robotId, payload);
    this.streams.get(robotId)?.next(payload);
  }

  /** SSE용 프레임 스트림. 구독 즉시 최신 프레임 1장이 있으면 흘려준다. */
  stream(robotId: string): Observable<FramePayload> {
    let subject = this.streams.get(robotId);
    if (!subject) {
      subject = new Subject<FramePayload>();
      this.streams.set(robotId, subject);
    }
    return subject.asObservable();
  }

  /** 최신 프레임 1장 (폴링/썸네일 폴백용). */
  getLatest(robotId: string): FramePayload | undefined {
    return this.latest.get(robotId);
  }

  /** 로봇 연결 해제 시 정리. */
  cleanup(robotId: string): void {
    this.latest.delete(robotId);
    this.streams.get(robotId)?.complete();
    this.streams.delete(robotId);
  }
}
