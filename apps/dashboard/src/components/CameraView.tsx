"use client";

/**
 * FPV 카메라 뷰 — 로봇 카메라 프레임을 SSE로 받아 실시간 표시.
 *
 * 탑승모드에서 스타키가 앞을 향하므로 이 화면이 1인칭 주행 뷰가 된다.
 * SSE(EventSource)를 쓰는 이유: 서버→브라우저 단방향 스트림이라 WebSocket보다
 * 가볍고, 끊기면 브라우저가 자동 재연결한다. 프레임은 base64 JPEG(data URL).
 */
import { useEffect, useRef, useState } from "react";
import { cameraStreamUrl } from "@/lib/gateway";
import styles from "./CameraView.module.css";

interface Props {
  robotId: string;
}

export default function CameraView({ robotId }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const es = new EventSource(cameraStreamUrl(robotId));
    // 직전 data URL을 revoke할 필요는 없음(blob 아님). FPS는 최근 1초 수신 수로 계산.
    const stamps: number[] = [];

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource가 자동 재연결 시도

    es.onmessage = (ev) => {
      let payload: { src?: string };
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload.src) return;

      if (imgRef.current) imgRef.current.src = payload.src;
      setHasFrame(true);

      const now = Date.now();
      stamps.push(now);
      while (stamps.length > 0 && now - stamps[0] > 1000) stamps.shift();
      setFps(stamps.length);
    };

    return () => es.close();
  }, [robotId]);

  return (
    <section className={styles.section}>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>FPV 주행 뷰</h3>
        <span
          className={`${styles.status} ${connected ? styles.on : styles.off}`}
          title={connected ? "스트림 연결됨" : "연결 끊김 (재연결 시도 중)"}
        >
          ● {connected ? `LIVE ${fps}fps` : "오프라인"}
        </span>
      </div>

      <div className={styles.frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL 스트림이라 next/image 부적합 */}
        <img ref={imgRef} alt="로봇 카메라" className={styles.img} />
        {!hasFrame && (
          <div className={styles.placeholder}>
            <p>카메라 프레임 대기 중…</p>
            <p className={styles.hint}>
              스타키가 탑승(또는 미러)모드로 프레임을 송신해야 보입니다.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
