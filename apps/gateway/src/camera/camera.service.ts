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

  /** 로봇별 Subject를 가져오거나 없으면 생성 (구독·방송 공용 진입점). */
  private subjectFor(robotId: string): Subject<FramePayload> {
    let subject = this.streams.get(robotId);
    if (!subject) {
      subject = new Subject<FramePayload>();
      this.streams.set(robotId, subject);
    }
    return subject;
  }

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
    this.subjectFor(robotId).next(payload);
  }

  /** SSE용 프레임 스트림. */
  stream(robotId: string): Observable<FramePayload> {
    return this.subjectFor(robotId).asObservable();
  }

  /** 최신 프레임 1장 (폴링/썸네일 폴백용). */
  getLatest(robotId: string): FramePayload | undefined {
    return this.latest.get(robotId);
  }

  /**
   * 로봇 연결 해제 시 정리.
   * Subject는 complete/삭제하지 않는다 — 열려 있는 SSE 구독(대시보드 탭)이 로봇
   * 재접속 후에도 같은 스트림으로 프레임을 계속 받게 하기 위함. complete시키면
   * 재접속해도 그 탭은 영영 프레임을 못 받아(완료된 Observable) 새로고침해야 한다.
   * robotId 종류는 유한해서 Subject 상주 비용은 무시 가능.
   */
  cleanup(robotId: string): void {
    this.latest.delete(robotId);
  }
}
