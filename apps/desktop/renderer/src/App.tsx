import { useEffect, useState } from "react";
import { ExpressiveOrb, type ExpressiveOrbMood } from "./components/ExpressiveOrb";
import "./App.css";

/** 球的六种状态 → 老师说的话。文案由 Mochi 人格统一，不出现“本地规则”黑话。 */
const MOOD_LABEL: Record<ExpressiveOrbMood, string> = {
  idle: "我在呢，想做点什么？",
  thinking: "让我想想…",
  listening: "我在听，你说",
  speaking: "好，我来说",
  success: "搞定啦",
  alert: "这里需要你确认一下",
};

type MochiBridge = {
  ping: () => Promise<{ ok: boolean; version: string; platform: string }>;
};

declare global {
  interface Window {
    mochi?: MochiBridge;
  }
}

export default function App() {
  const [mood, setMood] = useState<ExpressiveOrbMood>("idle");
  const [bridge, setBridge] = useState<string>("");

  // Batch 0 验收项之一：确认 preload 桥真的通了
  useEffect(() => {
    window.mochi?.ping().then((r) => setBridge(`v${r.version} · ${r.platform}`));
  }, []);

  return (
    <div className="mochi-shell">
      <div className="mochi-canvas">
        <div className="orb-stage">
          <ExpressiveOrb size={188} mood={mood} active interactive label="Mochi" />
        </div>

        {/* 有字的地方都要有圆角矩形 */}
        <div className="mochi-status" role="status" aria-live="polite">
          {MOOD_LABEL[mood]}
        </div>

        {/* Batch 0 只做状态切换器，Batch 2 接 dsh 后由事件流驱动 */}
        <div className="mochi-moodbar" role="group" aria-label="调试：切换球的状态">
          {(Object.keys(MOOD_LABEL) as ExpressiveOrbMood[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`mochi-chip${m === mood ? " is-on" : ""}`}
              onClick={() => setMood(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <footer className="mochi-footer">
        <span className="mochi-brand">Mochi</span>
        {bridge && <span className="mochi-meta">{bridge}</span>}
      </footer>
    </div>
  );
}
