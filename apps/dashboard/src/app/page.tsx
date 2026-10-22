"use client";

/**
 * 메인 페이지: 로봇 목록 폴링 + 컨트롤 패널.
 *
 * 레이아웃:
 *   [헤더]
 *   [로봇 카드 목록] ← 3초마다 GET /robots
 *   [컨트롤 패널]   ← 선택된 로봇에 리액션 / Say / Drive 전송
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRobots, postSay, type Robot } from "@/lib/gateway";
import RobotCard from "@/components/RobotCard";
import ReactionPad from "@/components/ReactionPad";
import DrivePad from "@/components/DrivePad";
import styles from "./page.module.css";

const POLL_INTERVAL_MS = 3000; // 로봇 목록 폴링 주기

export default function DashboardPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // Say 입력 상태
  const [sayText, setSayText] = useState("");
  const [isSaying, setIsSaying] = useState(false);

  // 폴링 타이머 ref — 언마운트 시 정리
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 로봇 목록을 한 번 조회하고 상태를 갱신 */
  const poll = useCallback(async () => {
    try {
      const list = await fetchRobots();
      setRobots(list);
      setPollError(null);

      // 선택된 로봇이 목록에서 사라졌으면 선택 해제
      if (selectedId && !list.find((r) => r.robotId === selectedId)) {
        setSelectedId(null);
      }
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "연결 오류");
    }
  }, [selectedId]);

  // 마운트 시 즉시 1회 조회 + 3초 폴링 시작
  useEffect(() => {
    void poll();
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [poll]);

  const selectedRobot = robots.find((r) => r.robotId === selectedId) ?? null;

  /** Say 버튼 핸들러 */
  const handleSay = async () => {
    if (!selectedRobot || !sayText.trim()) return;
    setIsSaying(true);
    try {
      await postSay(selectedRobot.robotId, sayText.trim());
      setSayText("");
    } finally {
      setIsSaying(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* ── 헤더 ── */}
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.accent}>SNACK</span> EXPRESS
        </h1>
        <span className={styles.subtitle}>로봇 조종 대시보드</span>
      </header>

      {/* ── 로봇 목록 ── */}
      <section className={styles.robotSection}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>연결된 로봇</h2>
          {pollError && (
            <span className={styles.error}>⚠ {pollError}</span>
          )}
          <span className={styles.count}>{robots.length}대</span>
        </div>

        {robots.length === 0 ? (
          /* 연결된 로봇이 없을 때 안내 */
          <div className={styles.emptyState}>
            <p>연결된 로봇이 없습니다.</p>
            <p className={styles.hint}>
              mock-robot을 켜보세요:{" "}
              <code className={styles.code}>pnpm mock-robot</code>
            </p>
          </div>
        ) : (
          <div className={styles.robotList}>
            {robots.map((robot) => (
              <RobotCard
                key={robot.robotId}
                robot={robot}
                selected={robot.robotId === selectedId}
                onSelect={() =>
                  setSelectedId((prev) =>
                    prev === robot.robotId ? null : robot.robotId,
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 컨트롤 패널 (로봇 선택 시에만 표시) ── */}
      {selectedRobot ? (
        <section className={styles.controlPanel}>
          <div className={styles.controlHeader}>
            <span className={styles.controlling}>
              조종 중:{" "}
              <strong className={styles.robotName}>
                {selectedRobot.robotId}
              </strong>
            </span>
          </div>

          <div className={styles.controlGrid}>
            {/* 리액션 패드 */}
            <ReactionPad robotId={selectedRobot.robotId} />

            {/* Say 입력 */}
            <section className={styles.saySection}>
              <h3 className={styles.panelTitle}>Say</h3>
              <div className={styles.sayRow}>
                <input
                  className={styles.sayInput}
                  type="text"
                  placeholder="로봇이 말할 텍스트..."
                  value={sayText}
                  onChange={(e) => setSayText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSay();
                  }}
                  maxLength={200}
                />
                <button
                  className={styles.sayBtn}
                  onClick={() => void handleSay()}
                  disabled={isSaying || !sayText.trim()}
                >
                  {isSaying ? "전송 중..." : "전송"}
                </button>
              </div>
            </section>

            {/* 드라이브 패드 */}
            <DrivePad robot={selectedRobot} />
          </div>
        </section>
      ) : (
        robots.length > 0 && (
          <p className={styles.selectHint}>
            위에서 로봇 카드를 클릭하면 조종을 시작합니다.
          </p>
        )
      )}
    </div>
  );
}
