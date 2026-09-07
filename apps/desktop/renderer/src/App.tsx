import { useCallback, useEffect, useRef, useState } from "react";
import { ExpressiveOrb, type ExpressiveOrbMood } from "./components/ExpressiveOrb";
import { InputBar } from "./components/InputBar";
import { ChatLog } from "./components/ChatLog";
import type { ChatMessage } from "./components/ChatBubble";
import { useMochiMood } from "./hooks/useMochiMood";
import { mochi } from "./api/mochi";
import { moodForEvent, type StreamEvent, type ApprovalRequest } from "./api/types";
import "./App.css";

/** Electron preload 暴露的桥（仅 ping 探测用，与 dsh 的 `mochi` 桥是两回事）。 */
type PreloadBridge = {
  ping: () => Promise<{ ok: boolean; version: string; platform: string }>;
};
declare global {
  interface Window {
    mochi?: PreloadBridge;
  }
}

/** 球的六种状态 → 老师说的话。文案由 Mochi 人格统一，不出现「本地规则」黑话。 */
const MOOD_LABEL: Record<ExpressiveOrbMood, string> = {
  idle: "我在呢，想做点什么？",
  thinking: "让我想想…",
  listening: "我在听，你说",
  speaking: "好，我来说",
  success: "搞定啦",
  alert: "这里需要你确认一下",
};

/** 调试快捷键循环切换的 mood 顺序（隐藏，不在 UI 暴露）。 */
const DEBUG_CYCLE: ExpressiveOrbMood[] = [
  "idle",
  "thinking",
  "listening",
  "speaking",
  "success",
  "alert",
];

// Batch 1 占位对话：Agent B 接真实 dsh 后由 onStream 填充，可删除。
const SEED_MESSAGES: ChatMessage[] = [
  { id: "m0", role: "mochi", text: "早，李老师。今天高一(1)班 1-2 节数学，需要我帮你做什么？" },
  { id: "m1", role: "teacher", text: "今天谁没到？" },
  { id: "m2", role: "mochi", text: "我查一下晨检记录。稍等。" },
  { id: "m3", role: "mochi", text: "高一(1)班今天应到 42 人，实到 40 人。请假 2 人：王浩（病假）、陈雨（事假）。没人超时未归。" },
  { id: "m4", role: "teacher", text: "帮我写个给王浩家长的请假知悉" },
  { id: "m5", role: "mochi", text: "好的，我起草一份给王浩家长的请假知悉，你确认后再发。" },
  { id: "m6", role: "teacher", text: "行，发吧" },
  { id: "m7", role: "mochi", text: "已发送。需要我把这次晨检汇总成一张表吗？" },
  { id: "m8", role: "teacher", text: "要的，顺便标出请假的" },
  { id: "m9", role: "mochi", text: "明白，我生成一张晨检表，把请假的标出来，等会儿给你。" },
];

let msgSeq = 0;
const nextId = () => `t${Date.now()}-${msgSeq++}`;

export default function App() {
  const { mood, trigger, setRaw } = useMochiMood("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [bridge, setBridge] = useState<string>("");
  // 正在流式输出时，把文字累积进最后一条 Mochi 气泡
  const streamingRef = useRef<{ id: string; full: string } | null>(null);
  // 镜像当前 mood，供隐藏调试快捷键读取（setRaw 只接受值，不接受 updater）
  const moodRef = useRef(mood);
  moodRef.current = mood;

  // Batch 0 验收项之一：确认 preload 桥真的通了
  useEffect(() => {
    window.mochi?.ping().then((r) => setBridge(`v${r.version} · ${r.platform}`));
  }, []);

  // 接入 dsh 流式事件：只做两件事——切球态 + 累积 Mochi 文字
  useEffect(() => {
    const off = mochi.onStream((ev: StreamEvent) => {
      trigger({ mood: moodForEvent(ev) });
      if (ev.type === "token") {
        setMessages((prev) => {
          const slot = streamingRef.current;
          if (!slot) {
            const id = nextId();
            streamingRef.current = { id, full: ev.text };
            return [...prev, { id, role: "mochi", text: ev.text }];
          }
          slot.full += ev.text;
          return prev.map((m) => (m.id === slot.id ? { ...m, text: slot.full } : m));
        });
      }
      if (ev.type === "success" || ev.type === "alert" || ev.type === "error") {
        streamingRef.current = null;
      }
    });
    return off;
  }, [trigger]);

  // 接入确认请求：Batch 2 才需要真实确认卡，这里先 console.log 占位
  useEffect(() => {
    const off = mochi.onApprovalRequest((req: ApprovalRequest) => {
      console.log("[mochi] 收到确认请求（Batch 2 将弹确认卡）：", req);
    });
    return off;
  }, []);

  // 隐藏调试快捷键：Cmd+Shift+D (Mac) / Ctrl+Shift+D (Win)。不在 UI 显示。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const i = DEBUG_CYCLE.indexOf(moodRef.current);
        setRaw(DEBUG_CYCLE[(i + 1) % DEBUG_CYCLE.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setRaw]);

  const handleSend = useCallback(
    (text: string) => {
      const id = nextId();
      setMessages((prev) => [...prev, { id, role: "teacher", text }]);
      streamingRef.current = null;
      // 用户刚点发送 → thinking
      trigger({ mood: "thinking" });
      // 调用 dsh 桥（Batch 1 为 stub，无真实回复；Agent B 接好即生效）
      void mochi.sendPrompt(text);
    },
    [trigger],
  );

  return (
    <div className="mochi-shell">
      <div className="mochi-canvas">
        <div className="orb-stage">
          <ExpressiveOrb size={176} mood={mood} active interactive label="Mochi" />
        </div>

        {/* 有字的地方都要有圆角矩形 */}
        <div className="mochi-status" role="status" aria-live="polite">
          {MOOD_LABEL[mood]}
        </div>

        {/* 历史对话滚动区：最大 60vh，横向不滚 */}
        <ChatLog messages={messages} teacherInitial="李" />
      </div>

      {/* 底部输入栏 */}
      <div className="mochi-composer">
        <InputBar onSend={handleSend} busy={mood === "thinking" || mood === "speaking"} />
      </div>

      <footer className="mochi-footer">
        <span className="mochi-brand">Mochi</span>
        {bridge && <span className="mochi-meta">{bridge}</span>}
      </footer>
    </div>
  );
}
