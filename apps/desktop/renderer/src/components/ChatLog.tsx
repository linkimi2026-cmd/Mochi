import { useEffect, useRef } from "react";
import type { ChatMessage } from "./ChatBubble";
import { ChatBubble } from "./ChatBubble";
import "./ChatLog.css";

type ChatLogProps = {
  messages: ChatMessage[];
  teacherInitial?: string;
};

/**
 * 历史对话滚动区。
 * - 单列纵向布局，max-height 60vh，超出垂直滚动。
 * - 横向 overflow-x: hidden，绝不出现横向滚动条（视觉红线 2）。
 * - 新消息到达时自动滚到底部。
 */
export function ChatLog({ messages, teacherInitial }: ChatLogProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="chat-log" role="log" aria-live="polite" aria-label="对话记录">
      {messages.map((m) => (
        <ChatBubble key={m.id} message={m} teacherInitial={teacherInitial} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
