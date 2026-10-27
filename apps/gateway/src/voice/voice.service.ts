/**
 * VoiceService — 오디오 청크 누적 → STT → LLM → TTS 파이프라인.
 *
 * 설계 결정:
 * - PCM 버퍼를 직접 WAV 헤더로 감싸서 OpenAI에 전달. 외부 라이브러리 없이 44바이트 헤더 직접 작성.
 * - TTS 응답은 response_format:"pcm"으로 받는다 (24kHz PCM16 — 로봇 재생측 주의: 16kHz 아님).
 * - LLM에게 JSON {reply, emotion} 포맷을 요구해 표정 시퀀스를 함께 결정한다.
 * - 로봇별 최근 6턴 대화 메모리를 유지해 문맥을 이어간다.
 * - OPENAI_API_KEY 미설정 시 고정 응답으로 폴백 (개발 모드).
 */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import type { AudioChunk, Expression } from '@snack-express/protocol';
import { RobotRegistryService } from '../robot/robot-registry.service';

// LLM이 반환하는 JSON 포맷
interface LlmResponse {
  reply: string;
  emotion: 'happy' | 'neutral' | 'surprised' | 'sad' | 'love';
}

// LLM 감정 → protocol Expression 매핑
const EMOTION_TO_EXPRESSION: Record<LlmResponse['emotion'], Expression> = {
  happy: 'happy',
  neutral: 'neutral',
  surprised: 'surprised',
  sad: 'sad',
  love: 'love',
};

// 스타키 페르소나 시스템 프롬프트
const SYSTEM_PROMPT = `너는 스타크챤이라는 귀여운 로봇이야. 이름은 스타키.
한국어로 대답하고, 1~2문장으로 짧게 말해. 장난기가 넘치고, 반말을 써.
대답은 반드시 JSON 형식으로: {"reply": "...", "emotion": "happy|neutral|surprised|sad|love"}`;

/**
 * PCM16 raw 데이터를 WAV 파일 포맷으로 감싼다.
 * 44바이트 헤더를 직접 작성 — 외부 라이브러리 불필요.
 * 로봇은 16kHz / 16bit / mono PCM을 전송한다.
 */
function pcmToWav(pcmData: Buffer): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8); // 32000
  const blockAlign = numChannels * (bitsPerSample / 8); // 2

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);           // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);            // AudioFormat = 1 (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  // robotId → 누적된 오디오 청크
  private readonly buffers = new Map<string, AudioChunk[]>();
  // robotId → 현재 파이프라인 실행 중 여부
  private readonly busyRobots = new Set<string>();
  // robotId → 최근 대화 이력 (최대 6턴 유지)
  private readonly history = new Map<
    string,
    Array<{ role: 'user' | 'assistant'; content: string }>
  >();

  private readonly openai: OpenAI | null;
  private readonly llmModel: string;
  private readonly ttsModel: string;
  private readonly ttsVoice: string;

  constructor(private readonly registry: RobotRegistryService) {
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    } else {
      this.openai = null;
      this.logger.warn('OPENAI_API_KEY 미설정 — 음성 파이프라인이 고정 응답으로 폴백됩니다');
    }
    this.llmModel = process.env.OPENAI_LLM_MODEL ?? 'gpt-4o-mini';
    this.ttsModel = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts';
    this.ttsVoice = process.env.OPENAI_TTS_VOICE ?? 'alloy';
  }

  /** 음성 턴 진행 중 여부. VisionService가 미러 모드 스킵 판단에 사용한다. */
  isBusy(robotId: string): boolean {
    return this.busyRobots.has(robotId);
  }

  /** 오디오 청크 수신. final=true면 파이프라인 실행. */
  handleChunk(robotId: string, chunk: AudioChunk): void {
    // 파이프라인 중 새로운 final이 오면 현재 버퍼를 버린다 (중복 방지)
    if (chunk.final && this.busyRobots.has(robotId)) {
      this.logger.warn(`[${robotId}] 파이프라인 실행 중 — 새 발화 버림`);
      this.buffers.delete(robotId);
      return;
    }

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
   * 음성 처리 파이프라인: STT → LLM → TTS.
   * 각 단계 소요 시간을 측정해 한 줄로 요약 로그한다.
   * 예: [voice] stt=820ms llm=640ms tts=1100ms total=2560ms
   */
  private async runVoicePipeline(robotId: string, chunks: AudioChunk[]): Promise<void> {
    this.busyRobots.add(robotId);
    const pipelineStart = Date.now();

    try {
      // API 키 없으면 고정 응답 폴백
      if (!this.openai) {
        this.logger.warn(`[${robotId}] API 키 없음 — 고정 응답 전송`);
        this.sendFallbackResponse(robotId);
        return;
      }

      // ── STT ────────────────────────────────────────────────────────────────
      const sttStart = Date.now();

      // base64 PCM 청크 → Buffer 연결 → WAV 헤더 추가
      const pcmBuffers = chunks.map((c) => Buffer.from(c.data, 'base64'));
      const pcmData = Buffer.concat(pcmBuffers);
      const wavBuffer = pcmToWav(pcmData);

      const wavFile = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });
      const transcription = await this.openai.audio.transcriptions.create({
        file: wavFile,
        model: 'gpt-4o-mini-transcribe',
        language: 'ko',
      });
      const transcript = transcription.text.trim();
      const sttMs = Date.now() - sttStart;
      this.logger.debug(`[${robotId}] STT: "${transcript}"`);

      // ── LLM ────────────────────────────────────────────────────────────────
      const llmStart = Date.now();

      // 대화 이력 조회 및 갱신
      const convHistory = this.history.get(robotId) ?? [];
      convHistory.push({ role: 'user', content: transcript });

      const completion = await this.openai.chat.completions.create({
        model: this.llmModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...convHistory,
        ],
        max_tokens: 200,
      });

      const rawContent = completion.choices[0]?.message?.content ?? '{"reply":"..","emotion":"neutral"}';
      let llmResp: LlmResponse;
      try {
        llmResp = JSON.parse(rawContent) as LlmResponse;
      } catch {
        llmResp = { reply: rawContent, emotion: 'neutral' };
      }

      // 이력에 어시스턴트 응답 추가. 최대 6턴(12개 메시지) 초과 시 앞에서 제거.
      convHistory.push({ role: 'assistant', content: llmResp.reply });
      if (convHistory.length > 12) {
        convHistory.splice(0, convHistory.length - 12);
      }
      this.history.set(robotId, convHistory);

      const llmMs = Date.now() - llmStart;
      this.logger.debug(`[${robotId}] LLM emotion=${llmResp.emotion}`);

      // ── TTS ────────────────────────────────────────────────────────────────
      const ttsStart = Date.now();

      // response_format:"pcm" → OpenAI가 24kHz / PCM16 / mono를 반환한다.
      // 주의: 로봇 펌웨어가 이 샘플레이트를 그대로 받아 재생해야 한다(16kHz 아님).
      const ttsResp = await this.openai.audio.speech.create({
        input: llmResp.reply,
        model: this.ttsModel,
        voice: this.ttsVoice,
        response_format: 'pcm',
      });

      const arrayBuf = await ttsResp.arrayBuffer();
      const pcmOut = Buffer.from(arrayBuf);
      const ttsMs = Date.now() - ttsStart;
      const totalMs = Date.now() - pipelineStart;

      // 타이밍 요약 로그 — 펌웨어 "느림" 문제 계측 기준선
      this.logger.log(
        `[voice] ${robotId} stt=${sttMs}ms llm=${llmMs}ms tts=${ttsMs}ms total=${totalMs}ms`,
      );

      // TTS PCM을 32KB 청크로 분할해 순차 전송
      const chunkSize = 32 * 1024;
      let seq = 0;
      for (let offset = 0; offset < pcmOut.length; offset += chunkSize) {
        const slice = pcmOut.subarray(offset, offset + chunkSize);
        const isFinal = offset + chunkSize >= pcmOut.length;
        this.registry.send(robotId, {
          type: 'tts.chunk',
          seq: seq++,
          data: slice.toString('base64'),
          final: isFinal,
        });
      }
      // PCM이 비어 있는 예외 케이스 처리
      if (pcmOut.length === 0) {
        this.registry.send(robotId, { type: 'tts.chunk', seq: 0, data: '', final: true });
      }

      // 감정 표정 시퀀스 전송
      const expression = EMOTION_TO_EXPRESSION[llmResp.emotion] ?? 'neutral';
      this.registry.send(robotId, {
        type: 'sequence',
        id: `voice-${Date.now()}`,
        steps: [{ expression, durationMs: 2500 }],
      });
    } catch (err) {
      this.logger.error(`[${robotId}] 파이프라인 에러: ${String(err)}`);
      this.registry.send(robotId, {
        type: 'sequence',
        id: `voice-err-${Date.now()}`,
        steps: [{ expression: 'sad', text: '으엉 안 들렸어', durationMs: 2000 }],
      });
    } finally {
      this.busyRobots.delete(robotId);
    }
  }

  /**
   * 합성 PCM(24kHz/16bit/mono)을 로봇 스피커로 재생한다 (효과음용).
   * tts.chunk 스트림을 그대로 재사용 — 로봇은 도착 순서대로 재생만 한다.
   */
  playPcm(robotId: string, pcm: Buffer): void {
    const chunkSize = 32 * 1024;
    let seq = 0;
    for (let offset = 0; offset < pcm.length; offset += chunkSize) {
      const slice = pcm.subarray(offset, offset + chunkSize);
      this.registry.send(robotId, {
        type: 'tts.chunk',
        seq: seq++,
        data: slice.toString('base64'),
        final: offset + chunkSize >= pcm.length,
      });
    }
  }

  /**
   * 지정 텍스트를 TTS로 합성해 로봇에게 말하게 한다 (씬 연출용 — 대화 이력과 무관).
   * 표정을 함께 주면 발화 동안 그 표정+말풍선 sequence도 전송한다.
   * OpenAI 키가 없으면 말풍선만 보낸다(무음 폴백).
   */
  async speak(
    robotId: string,
    text: string,
    expression: Expression = 'happy',
  ): Promise<void> {
    if (!this.openai) {
      // 키 없음 — 말풍선만
      this.registry.send(robotId, {
        type: 'sequence',
        id: `speak-${Date.now()}`,
        steps: [{ expression, text, durationMs: 3000 }],
      });
      return;
    }

    // 표정만 즉시 (선글라스 등 연출 타이밍 유지). 텍스트 말풍선은 TTS 합성이
    // 끝난 뒤 음성과 "동시에" 보낸다 — 먼저 보내면 합성 지연(2~4초) 동안
    // 말풍선이 먼저 사라지고 나서야 음성이 나오는 엇박자가 생긴다(실측).
    this.registry.send(robotId, {
      type: 'sequence',
      id: `speak-pre-${Date.now()}`,
      steps: [{ expression, durationMs: 8000 }],
    });

    try {
      const ttsResp = await this.openai.audio.speech.create({
        input: text,
        model: this.ttsModel,
        voice: this.ttsVoice,
        response_format: 'pcm',
      });
      const pcmOut = Buffer.from(await ttsResp.arrayBuffer());

      // 말풍선 지속시간 = 실제 음성 길이(24kHz/16bit/mono) + 여유 1초
      const audioMs = Math.round((pcmOut.length / 2 / 24000) * 1000);
      this.registry.send(robotId, {
        type: 'sequence',
        id: `speak-${Date.now()}`,
        steps: [{ expression, text, durationMs: Math.min(audioMs + 1000, 10_000) }],
      });

      const chunkSize = 32 * 1024;
      let seq = 0;
      for (let offset = 0; offset < pcmOut.length; offset += chunkSize) {
        const slice = pcmOut.subarray(offset, offset + chunkSize);
        this.registry.send(robotId, {
          type: 'tts.chunk',
          seq: seq++,
          data: slice.toString('base64'),
          final: offset + chunkSize >= pcmOut.length,
        });
      }
    } catch (err) {
      this.logger.warn(`[${robotId}] speak TTS 실패 (말풍선만 표시): ${String(err)}`);
      this.registry.send(robotId, {
        type: 'sequence',
        id: `speak-fb-${Date.now()}`,
        steps: [{ expression, text, durationMs: 3000 }],
      });
    }
  }

  /**
   * 텍스트로 말 걸기 — 음성 턴에서 STT만 생략한 대화.
   * LLM이 스타키의 답변·감정을 생성하고 speak()로 발화한다.
   * 대화 이력은 음성 턴과 공유 — 마이크로 말하다 키보드로 이어가도 맥락 유지.
   */
  async chat(robotId: string, userText: string): Promise<void> {
    if (this.busyRobots.has(robotId)) {
      this.logger.warn(`[${robotId}] 파이프라인 실행 중 — chat 무시`);
      return;
    }
    if (!this.openai) {
      await this.speak(robotId, '안녕! 나는 스타키야!');
      return;
    }

    this.busyRobots.add(robotId);
    const t0 = Date.now();
    try {
      const convHistory = this.history.get(robotId) ?? [];
      convHistory.push({ role: 'user', content: userText });

      const completion = await this.openai.chat.completions.create({
        model: this.llmModel,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...convHistory],
        max_tokens: 200,
      });
      const rawContent =
        completion.choices[0]?.message?.content ?? '{"reply":"..","emotion":"neutral"}';
      let llmResp: LlmResponse;
      try {
        llmResp = JSON.parse(rawContent) as LlmResponse;
      } catch {
        llmResp = { reply: rawContent, emotion: 'neutral' };
      }

      convHistory.push({ role: 'assistant', content: llmResp.reply });
      if (convHistory.length > 12) {
        convHistory.splice(0, convHistory.length - 12);
      }
      this.history.set(robotId, convHistory);

      const expression = EMOTION_TO_EXPRESSION[llmResp.emotion] ?? 'neutral';
      await this.speak(robotId, llmResp.reply, expression);
      this.logger.log(`[chat] ${robotId} "${userText}" -> "${llmResp.reply}" (${Date.now() - t0}ms)`);
    } catch (err) {
      this.logger.error(`[${robotId}] chat 에러: ${String(err)}`);
      this.registry.send(robotId, {
        type: 'sequence',
        id: `chat-err-${Date.now()}`,
        steps: [{ expression: 'sad', text: '으엉 잘 안 들렸어', durationMs: 2000 }],
      });
    } finally {
      this.busyRobots.delete(robotId);
    }
  }

  /** API 키 없을 때 또는 에러 시 전송하는 고정 응답 */
  private sendFallbackResponse(robotId: string): void {
    this.registry.send(robotId, { type: 'tts.chunk', seq: 0, data: 'AAAA', final: true });
    this.registry.send(robotId, {
      type: 'sequence',
      id: `voice-fallback-${Date.now()}`,
      steps: [{ expression: 'happy', text: '안녕! 나는 스타키야!', durationMs: 2000 }],
    });
  }

  /** 로봇 연결 해제 시 이력 정리 */
  cleanup(robotId: string): void {
    this.buffers.delete(robotId);
    this.busyRobots.delete(robotId);
    this.history.delete(robotId);
  }
}
