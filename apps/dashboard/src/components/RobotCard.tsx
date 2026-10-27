"use client";

/**
 * 로봇 한 대의 상태를 표시하는 카드 컴포넌트 (표시 전용).
 * 조종은 통합 컨트롤러가 능력(capabilities) 기반으로 자동 라우팅한다.
 */
import type { Robot } from "@/lib/gateway";
import styles from "./RobotCard.module.css";

interface Props {
  robot: Robot;
}

/** 모드 → 한국어 레이블 + CSS 클래스 */
const MODE_LABEL: Record<Robot["mode"], { text: string; color: string }> = {
  idle: { text: "대기", color: "#888899" },
  listening: { text: "듣는 중", color: "#00f0ff" },
  speaking: { text: "말하는 중", color: "#ff00aa" },
  mirror: { text: "미러 모드", color: "#aa88ff" },
  driving: { text: "주행 중", color: "#00ffaa" },
};

export default function RobotCard({ robot }: Props) {
  const mode = MODE_LABEL[robot.mode] ?? { text: robot.mode, color: "#888899" };

  return (
    <div className={styles.card}>
      {/* 로봇 ID + 펌웨어 버전 */}
      <div className={styles.header}>
        <span className={styles.robotId}>{robot.robotId}</span>
        <span className={styles.firmware}>fw {robot.firmware}</span>
      </div>

      {/* 현재 모드 */}
      <div className={styles.mode} style={{ color: mode.color }}>
        ● {mode.text}
      </div>

      {/* 배터리 + 착좌 상태 */}
      <div className={styles.status}>
        {robot.batteryPct !== undefined && (
          <span className={styles.badge}>
            🔋 {robot.batteryPct}%
          </span>
        )}
        {robot.seated !== undefined && (
          <span className={styles.badge}>
            {robot.seated ? "🚗 착좌" : "🅿️ 이탈"}
          </span>
        )}
      </div>

      {/* capabilities 뱃지 목록 */}
      <div className={styles.caps}>
        {robot.capabilities.map((cap) => (
          <span key={cap} className={styles.cap}>
            {cap}
          </span>
        ))}
      </div>
    </div>
  );
}
