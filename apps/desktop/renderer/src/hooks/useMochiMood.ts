import { useCallback, useRef, useState } from "react";
import type { ExpressiveOrbMood } from "../components/ExpressiveOrb";

/** 球的表情即 dsh 运行时状态的视觉投影，复用 ExpressiveOrb 原生 mood，不另造。 */
export type MochiMood = ExpressiveOrbMood;

/**
 * 触发一次表情变化。
 * - 传入 `{ mood }` 才生效（Partial 允许 Agent B 未来扩展其它字段）。
 * - 传入 `success` 时，1.5 秒后自动回落 idle（与 10_TEACHER_UX §6.3 一致）。
 */
export type MoodTrigger = { mood?: MochiMood };

const SUCCESS_HOLD_MS = 1500;

export function useMochiMood(initial: MochiMood = "idle") {
  const [mood, setMood] = useState<MochiMood>(initial);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimer.current) {
      clearTimeout(successTimer.current);
      successTimer.current = null;
    }
  }, []);

  const trigger = useCallback(
    (m: MoodTrigger) => {
      if (!m.mood) return;
      clearSuccessTimer();
      setMood(m.mood);
      if (m.mood === "success") {
        successTimer.current = setTimeout(() => setMood("idle"), SUCCESS_HOLD_MS);
      }
    },
    [clearSuccessTimer],
  );

  /** 调试用：不经过 success 定时器，直接定格某个表情（Cmd+Shift+D 循环）。 */
  const setRaw = useCallback(
    (m: MochiMood) => {
      clearSuccessTimer();
      setMood(m);
    },
    [clearSuccessTimer],
  );

  return { mood, trigger, setRaw };
}
