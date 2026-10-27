"use client";

/**
 * 메인 페이지: 연결 기기 상태 + 통합 컨트롤러.
 *
 * 레이아웃:
 *   [헤더]
 *   [연결된 기기 목록]  ← 상태 표시 전용 (3초마다 GET /robots)
 *   [통합 컨트롤러 1개] ← 기능별로 알맞은 로봇에 자동 라우팅:
 *       표정·Say·말걸기 → face 능력 로봇(스타키)
 *       주행·클락션     → drive 능력 로봇(차량)
 *     해당 능력 로봇이 없으면 그 부분만 비활성화된다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRobots, postChat, postSpeak, type Robot } from "@/lib/gateway";
import RobotCard from "@/components/RobotCard";
import ReactionPad from "@/components/ReactionPad";
import DrivePad from "@/components/DrivePad";
import styles from "./page.module.css";

const POLL_INTERVAL_MS = 3000; // 로봇 목록 폴링 주기

export default function DashboardPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);

  // 텍스트 입력 상태 (Say = 따라 말하기 / Chat = 말 걸기)
  const [sayText, setSayText] = useState("");
  const [isSaying, setIsSaying] = useState(false);
  const [chatText, setChatText] = useState("");
  const [isChatting, setIsChatting] = useState(false);

  // 폴링 타이머 ref — 언마운트 시 정리
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 로봇 목록을 한 번 조회하고 상태를 갱신 */
  const poll = useCallback(async () => {
    try {
      const list = await fetchRobots();
      setRobots(list);
      setPollError(null);
    } catch (e) {
      setPollError(e instanceof Error ? e.message : "연결 오류");
    }
  }, []);

  // 마운트 시 즉시 1회 조회 + 3초 폴링 시작
  useEffect(() => {
    void poll();
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [poll]);

  // 능력 기반 라우팅: 표정·발화는 face 로봇에게, 주행은 drive 로봇에게.
  const faceRobot = robots.find((r) => r.capabilities.includes("face")) ?? null;
  const driveRobot = robots.find((r) => r.capabilities.includes("drive")) ?? null;

  /** Speak: 입력한 문장을 그대로 발화 */
  const handleSay = async () => {
    if (!faceRobot || !sayText.trim()) return;
    setIsSaying(true);
    try {
      await postSpeak(faceRobot.robotId, sayText.trim());
      setSayText("");
    } finally {
      setIsSaying(false);
    }
  };

  /** Chat: 말을 걸면 LLM이 답변을 생성해 발화 */
  const handleChat = async () => {
    if (!faceRobot || !chatText.trim()) return;
    setIsChatting(true);
    try {
      await postChat(faceRobot.robotId, chatText.trim());
      setChatText("");
    } finally {
      setIsChatting(false);
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

      {/* ── 연결된 기기 (상태 표시 전용) ── */}
      <section className={styles.robotSection}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>연결된 기기</h2>
          {pollError && (
            <span className={styles.error}>⚠ {pollError}</span>
          )}
          <span className={styles.count}>{robots.length}대</span>
        </div>

        {robots.length === 0 ? (
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
              <RobotCard key={robot.robotId} robot={robot} />
            ))}
          </div>
        )}
      </section>

      {/* ── 통합 컨트롤러 (로봇이 1대라도 있으면 표시) ── */}
      {robots.length > 0 && (
        <section className={styles.controlPanel}>
          <div className={styles.controlHeader}>
            <span className={styles.controlling}>
              컨트롤러{" "}
              <strong className={styles.robotName}>
                {faceRobot ? `🙂 ${faceRobot.robotId}` : "🙂 (미접속)"}
                {" · "}
                {driveRobot ? `🚗 ${driveRobot.robotId}` : "🚗 (미접속)"}
              </strong>
            </span>
          </div>

          <div className={styles.controlGrid}>
            {/* 표정 — face 로봇 */}
            {faceRobot && <ReactionPad robotId={faceRobot.robotId} />}

            {/* 말 걸기 / Say — face 로봇 */}
            <section className={styles.saySection}>
              <h3 className={styles.panelTitle}>말 걸기</h3>
              <div className={styles.sayRow}>
                <input
                  className={styles.sayInput}
                  type="text"
                  placeholder={
                    faceRobot
                      ? "스타키에게 말을 걸어보세요... (답변을 생성해요)"
                      : "face 로봇 미접속"
                  }
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleChat();
                  }}
                  maxLength={200}
                  disabled={!faceRobot}
                />
                <button
                  className={styles.sayBtn}
                  onClick={() => void handleChat()}
                  disabled={!faceRobot || isChatting || !chatText.trim()}
                >
                  {isChatting ? "생각 중..." : "말 걸기"}
                </button>
              </div>

              <h3 className={styles.panelTitle} style={{ marginTop: 14 }}>
                Speak (따라 말하기)
              </h3>
              <div className={styles.sayRow}>
                <input
                  className={styles.sayInput}
                  type="text"
                  placeholder={
                    faceRobot ? "이 문장을 그대로 읽어요..." : "face 로봇 미접속"
                  }
                  value={sayText}
                  onChange={(e) => setSayText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSay();
                  }}
                  maxLength={200}
                  disabled={!faceRobot}
                />
                <button
                  className={styles.sayBtn}
                  onClick={() => void handleSay()}
                  disabled={!faceRobot || isSaying || !sayText.trim()}
                >
                  {isSaying ? "전송 중..." : "전송"}
                </button>
              </div>
            </section>

            {/* 주행 + 클락션 — drive 로봇 */}
            {driveRobot && <DrivePad robot={driveRobot} />}
          </div>
        </section>
      )}
    </div>
  );
}
