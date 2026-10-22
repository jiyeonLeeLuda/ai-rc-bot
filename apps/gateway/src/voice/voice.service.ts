/**
 * VoiceService — 오디오 청크를 누적하고 발화 완료 시 파이프라인을 실행.
 *
 * 실제 STT/LLM/TTS 연동은 TODO 주석으로 지점을 명시해 두었다.
 * 지금은 파이프라인 각 단계의 타이밍을 로그로 남기고 고정 응답을 반환한다.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AudioChunk } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  // robotId → 누적된 오디오 청크 배열
  private readonly buffers = new Map<string, AudioChunk[]>();

  constructor(private readonly registry: RobotRegistryService) {}

  /** 오디오 청크 수신. final=true면 파이프라인 실행. */
  handleChunk(robotId: string, chunk: AudioChunk): void {
    if (!this.buffers.has(robotId)) {
      this.buffers.set(robotId, []);
    }
    this.buffers.get(robotId)!.push(chunk);

    if (chunk.final) {
      const chunks = this.buffers.get(robotId) ?? [];
      this.buffers.delete(robotId);
      void this.runVoicePipeline(robotId, chunks);
    }
  }

  /**
   * 음성 처리 파이프라인 (STT → LLM → TTS).
   * 각 단계에서 소요 시간을 측정해 로그로 남긴다.
   * 현재는 스텁: 단계별 타이밍만 기록하고 고정 응답을 반환한다.
   */
  private async runVoicePipeline(robotId: string, chunks: AudioChunk[]): Promise<void> {
    const totalBytes = chunks.reduce((n, c) => n + c.data.length, 0);
    this.logger.log(`[${robotId}] Pipeline start — ${chunks.length} chunks, ~${totalBytes} base64 bytes`);

    // ── STT 단계 ──────────────────────────────────────────────────────────────
    const sttStart = Date.now();
    // TODO: OpenAI Whisper 연동
    //   const transcript = await openai.audio.transcriptions.create({
    //     file: pcmToWavBuffer(chunks),
    //     model: 'whisper-1',
    //   });
    const transcript = '(STT 스텁)';
    this.logger.debug(`[${robotId}] STT done in ${Date.now() - sttStart}ms: "${transcript}"`);

    // ── LLM 단계 ──────────────────────────────────────────────────────────────
    const llmStart = Date.now();
    // TODO: OpenAI Chat 연동
    //   const completion = await openai.chat.completions.create({ ... });
    const replyText = '안녕! 나는 스타크챤이야.';
    this.logger.debug(`[${robotId}] LLM done in ${Date.now() - llmStart}ms`);

    // ── TTS 단계 ──────────────────────────────────────────────────────────────
    const ttsStart = Date.now();
    // TODO: OpenAI TTS 연동 (streaming)
    //   const speech = await openai.audio.speech.create({ input: replyText, model: 'tts-1', voice: 'alloy' });
    //   로봇으로 tts.chunk를 스트리밍 전송
    this.logger.debug(`[${robotId}] TTS done in ${Date.now() - ttsStart}ms`);

    // 고정 응답: 무음 TTS 청크 1개 + happy 리액션 시퀀스
    // (실제 TTS 오디오는 TODO; AAAA는 최소 base64 플레이스홀더)
    this.registry.send(robotId, { type: 'tts.chunk', seq: 0, data: 'AAAA', final: true });
    this.registry.send(robotId, {
      type: 'sequence',
      id: `voice-response-${Date.now()}`,
      steps: [{ expression: 'happy', text: replyText, durationMs: 2000 }],
    });

    this.logger.log(`[${robotId}] Pipeline complete`);
  }
}
