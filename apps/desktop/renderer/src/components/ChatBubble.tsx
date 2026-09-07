import { OrbCompanion } from "./OrbCompanion";
import "./ChatBubble.css";

export type ChatRole = "teacher" | "mochi";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

type ChatBubbleProps = {
  message: ChatMessage;
  /** 老师头像首字母（默认「李」，对应示例老师）。 */
  teacherInitial?: string;
};

/**
 * 单条对话气泡。
 * - 老师：右侧，圆形字母头像 + 焦糖描边气泡。
 * - Mochi：左侧，OrbCompanion 缩到 32px 当头像 + 纸面气泡。
 * 所有文字容器都是圆角矩形（气泡本身即有底色 + radius）。
 */
export function ChatBubble({ message, teacherInitial = "李" }: ChatBubbleProps) {
  const isTeacher = message.role === "teacher";
  return (
    <div className={`chat-row chat-row--${isTeacher ? "teacher" : "mochi"}`}>
      {!isTeacher && (
        <div className="chat-avatar chat-avatar--mochi" aria-hidden="true">
          <OrbCompanion size={32} state="idle" label="Mochi" />
        </div>
      )}
      <div className="chat-bubble">{message.text}</div>
      {isTeacher && (
        <div className="chat-avatar chat-avatar--teacher" aria-hidden="true">
          {teacherInitial}
        </div>
      )}
    </div>
  );
}
