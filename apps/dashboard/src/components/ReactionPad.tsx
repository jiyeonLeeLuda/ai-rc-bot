"use client";

/**
 * 선택된 로봇에 리액션을 전송하는 버튼 패드.
 * 8개 리액션 × 이모지 레이블.
 */
import { useCallback, useState } from "react";
import { postReaction, type ReactionName } from "@/lib/gateway";
import styles from "./ReactionPad.module.css";

interface Props {
  robotId: string;
}

/** 리액션 이름 → 표시 이모지 매핑 */
const REACTIONS: { name: ReactionName; emoji: string; label: string }[] = [
  { name: "mirror-happy", emoji: "🙂", label: "happy" },
  { name: "mirror-surprised", emoji: "😮", label: "surprised" },
  { name: "mirror-wink", emoji: "😉", label: "wink" },
  { name: "blowkiss", emoji: "💋", label: "blowkiss" },
  { name: "bangya", emoji: "👉🔫", label: "bangya" },
  { name: "hook", emoji: "🥊", label: "hook" },
  { name: "wave", emoji: "👋", label: "wave" },
  { name: "heart", emoji: "❤️", label: "heart" },
];

export default function ReactionPad({ robotId }: Props) {
  // 마지막으로 전송한 리액션(시각 피드백용)
  const [last, setLast] = useState<ReactionName | null>(null);

  const handleReaction = useCallback(
    async (name: ReactionName) => {
      setLast(name);
      await postReaction(robotId, name);
    },
    [robotId],
  );

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>리액션</h3>
      <div className={styles.grid}>
        {REACTIONS.map(({ name, emoji, label }) => (
          <button
            key={name}
            className={`${styles.btn} ${last === name ? styles.active : ""}`}
            onClick={() => handleReaction(name)}
            title={name}
          >
            <span className={styles.emoji}>{emoji}</span>
            <span className={styles.label}>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
