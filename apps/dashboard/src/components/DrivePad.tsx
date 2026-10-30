"use client";

/**
 * WASD 드라이브 패드 — 탱크 아케이드(믹싱) 드라이브.
 *
 * [아크 턴]
 *   전진(W/S)과 회전(A/D)을 동시에 누르면 두 입력을 "믹싱"해 양쪽 트랙 속도를
 *   다르게 준다 → 전진하며 부드럽게 선회(실제 탱크 선회 방식). 교차 전송이 아니라
 *   한 번에 differential 속도를 보낸다.
 *     throttle = W(+1)/S(-1),  steer = D(+1)/A(-1)
 *     left  = clamp(throttle + GAIN*steer)
 *     right = clamp(throttle - GAIN*steer)
 *   예) W+D → left 1.0 / right 0.3 (전진하며 우측 아크)
 *
 * [데드맨 스위치]
 *   키를 누르는 동안 150ms 간격으로 drive 명령 반복 전송(ttlMs=300). 떼면 즉시
 *   정지 명령 1회 + 이후 미수신 시 로봇이 300ms 내 자동 정지.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { postDrive, postScene, type Robot } from "@/lib/gateway";
import styles from "./DrivePad.module.css";

interface Props {
  robot: Robot;
}

type DirKey = "w" | "a" | "s" | "d";
const DIR_KEYS: DirKey[] = ["w", "a", "s", "d"];

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

const INTERVAL_MS = 150;  // 반복 전송 간격
const TTL_MS = 300;       // 로봇 측 명령 유효 시간 (데드맨 스위치)
const STEER_GAIN = 0.7;   // 회전 강도 (전진 중 아크 곡률 / 제자리 회전 속도)

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** 현재 눌린 키 집합 → 좌/우 트랙 출력 믹싱 */
function mixDrive(held: Set<DirKey>): { left: number; right: number } {
  const throttle = (held.has("w") ? 1 : 0) + (held.has("s") ? -1 : 0);
  const steer = (held.has("d") ? 1 : 0) + (held.has("a") ? -1 : 0);
  return {
    left: clamp(throttle + STEER_GAIN * steer),
    right: clamp(throttle - STEER_GAIN * steer),
  };
}

export default function DrivePad({ robot }: Props) {
  const hasDrive = robot.capabilities.includes("drive");

  const heldRef = useRef<Set<DirKey>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // UI 하이라이트용 (눌린 키들)
  const [active, setActive] = useState<DirKey[]>([]);

  /** 현재 눌린 키 믹싱 결과를 1회 전송 */
  const sendTick = useCallback(() => {
    const { left, right } = mixDrive(heldRef.current);
    if (left === 0 && right === 0) return;
    void postDrive(robot.robotId, { left, right, ttlMs: TTL_MS });
  }, [robot.robotId]);

  /** 키 누름: 집합에 추가하고 전송 루프 보장 */
  const press = useCallback(
    (key: DirKey) => {
      if (!hasDrive || heldRef.current.has(key)) return;
      heldRef.current.add(key);
      setActive([...heldRef.current]);
      if (timerRef.current === null) {
        sendTick(); // 즉시 1회
        timerRef.current = setInterval(sendTick, INTERVAL_MS);
      }
    },
    [hasDrive, sendTick],
  );

  /** 키 뗌: 집합에서 제거, 비면 정지 */
  const release = useCallback(
    (key: DirKey) => {
      if (!heldRef.current.delete(key)) return;
      setActive([...heldRef.current]);
      if (heldRef.current.size === 0 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        void postDrive(robot.robotId, { left: 0, right: 0, ttlMs: TTL_MS }); // 즉시 정지
      }
    },
    [robot.robotId],
  );

  /** 포인터가 패드를 벗어나는 등 전체 해제 */
  const releaseAll = useCallback(() => {
    heldRef.current.clear();
    setActive([]);
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      void postDrive(robot.robotId, { left: 0, right: 0, ttlMs: TTL_MS });
    }
  }, [robot.robotId]);

  // 키보드 WASD — 동시 입력 지원(여러 키 held)
  useEffect(() => {
    if (!hasDrive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase() as DirKey;
      if (DIR_KEYS.includes(key)) press(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase() as DirKey;
      if (DIR_KEYS.includes(key)) release(key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // 창 포커스 잃으면 멈춤(키업 유실 방지)
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [hasDrive, press, release, releaseAll]);

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
                  className={`${styles.btn} ${active.includes(key) ? styles.pressed : ""}`}
                  disabled={!hasDrive}
                  onPointerDown={() => press(key)}
                  onPointerUp={() => release(key)}
                  onPointerLeave={() => release(key)}
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
        <>
          <button
            className={styles.btn}
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => void postScene("horn")}
            aria-label="클락션"
          >
            📢 빵빵~
          </button>
          <p className={styles.hint}>
            키보드 WASD — W+D 동시에 누르면 전진하며 우회전(아크)
          </p>
        </>
      )}
    </section>
  );
}
