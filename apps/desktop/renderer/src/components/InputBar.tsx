import { useRef, useState, type KeyboardEvent } from "react";
import "./InputBar.css";

type InputBarProps = {
  /** 发送回调；传空字符串会被忽略。 */
  onSend: (text: string) => void;
  /** 是否处于「Mochi 正在处理」状态：禁用输入、按钮转圈。 */
  busy?: boolean;
};

/**
 * 底部输入栏。
 * - 圆角很大的纸面输入框，符合「平静感」。
 * - 焦糖色发送按钮，按下有 spring 反馈（CSS active + :active 缩放）。
 * - Enter 发送，Shift+Enter 换行。
 * - 占位文字从 Mochi 人格提炼：口语化、不要求写 prompt。
 */
export function InputBar({ onSend, busy = false }: InputBarProps) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
    // 发送后把高度还原，避免上一句撑开的框留着
    const ta = taRef.current;
    if (ta) ta.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    // Shift+Enter 走默认行为（换行）
  };

  // 自适应高度：随内容长高，但封顶（封顶后内部滚动由 CSS 控制）
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  };

  return (
    <form
      className="mochi-inputbar"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={taRef}
        className="mochi-inputbar__field"
        placeholder="跟 Mochi 说点什么……"
        value={text}
        rows={1}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onInput={onInput}
        aria-label="给 Mochi 发消息"
      />
      <button
        type="submit"
        className="mochi-inputbar__send"
        disabled={busy || text.trim().length === 0}
        aria-label="发送"
      >
        {busy ? "处理中" : "发送"}
      </button>
    </form>
  );
}
