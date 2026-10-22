"use client";

/**
 * WASD 드라이브 패드 — 탱크 드라이브 방식.
 *
 * [데드맨 스위치 설계]
 *   버튼을 누르는 동안 150ms 간격으로 drive 명령을 반복 전송.
 *   각 명령의 ttlMs=300이므로, 로봇은 마지막 명령 수신 후 300ms 내에
 *   다음 명령이 없으면 자동 정지한다. Wi-Fi 단절 시에도 로봇이 폭주하지 않는
 *   안전장치다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { postDrive, type Robot } from "@/lib/gateway";
import styles from "./DrivePad.module.css";

interface Props {
  robot: Robot;
}

type DirKey = "w" | "a" | "s" | "d";

/** 방향 키 → 좌/우 모터 출력 (−1 ~ 1). 탱크 드라이브 방식. */
const DRIVE_MAP: Record<DirKey, { left: number; right: number }> = {
  w: { left: 1, right: 1 },      // 전진
  s: { left: -1, right: -1 },    // 후진
  a: { left: -0.6, right: 0.6 }, // 제자리 좌회전
  d: { left: 0.6, right: -0.6 }, // 제자리 우회전
};

/** 버튼 레이아웃 [row][col] — 십자 형태 */
const PAD_LAYOUT: (DirKey | null)[][] = [
  [null, "w", null],
  ["a", "s", "d"],
];

const DIR_LABEL: Record<DirKey, string> = {
  w: "▲",
  s: "▼",
  a: "◀",
  d: "▶",
};

const INTERVAL_MS = 150; // 반복 전송 간격
const TTL_MS = 300;      // 로봇 측 명령 유효 시간 (데드맨 스위치)

export default function DrivePad({ robot }: Props) {
  // drive capability가 없는 로봇은 패드 전체 비활성화
  const hasDrive = robot.capabilities.includes("drive");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 현재 눌린 방향 (UI 피드백용)
  const [activeKey, setActiveKey] = useState<DirKey | null>(null);

  /** 반복 전송 중지 */
  const stopDriving = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActiveKey(null);
  }, []);

  /** 지정 방향으로 반복 전송 시작 */
  const startDriving = useCallback(
    (key: DirKey) => {
      if (!hasDrive) return;
      // 이미 같은 방향이면 무시
      if (timerRef.current !== null) stopDriving();

      const { left, right } = DRIVE_MAP[key];
      const send = () =>
        void postDrive(robot.robotId, { left, right, ttlMs: TTL_MS });

      setActiveKey(key);
      send(); // 즉시 1회 전송
      timerRef.current = setInterval(send, INTERVAL_MS);
    },
    [hasDrive, robot.robotId, stopDriving],
  );

  // 키보드 WASD 지원 (컴포넌트 마운트 시 window에 이벤트 바인딩)
  useEffect(() => {
    if (!hasDrive) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase() as DirKey;
      if (key in DRIVE_MAP && timerRef.current === null) startDriving(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in DRIVE_MAP) stopDriving();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      stopDriving();
    };
  }, [hasDrive, startDriving, stopDriving]);

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>
        드라이브
        {!hasDrive && <span className={styles.disabled}> (미지원)</span>}
      </h3>
      <div className={styles.pad}>
        {PAD_LAYOUT.map((row, ri) => (
          <div key={ri} className={styles.row}>
            {row.map((key, ci) =>
              key === null ? (
                <span key={ci} className={styles.empty} />
              ) : (
                <button
                  key={key}
                  className={`${styles.btn} ${activeKey === key ? styles.pressed : ""}`}
                  disabled={!hasDrive}
                  onPointerDown={() => startDriving(key)}
                  onPointerUp={stopDriving}
                  onPointerLeave={stopDriving}
                  aria-label={key}
                >
                  {DIR_LABEL[key]}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
      {hasDrive && (
        <p className={styles.hint}>키보드 WASD로도 조종 가능</p>
      )}
    </section>
  );
}
