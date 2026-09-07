import { useReducedMotion } from "motion/react";
import { ExpressiveOrb, type ExpressiveOrbMood } from "./ExpressiveOrb";

/**
 * 表情球的工作台模组：球 + 球前的一台小电脑。
 *
 * 动作模组借自开源桌宠 Clawd / ClawdGotchi（stevysmith/clawdgotchi、
 * rullerzhou-afk/clawd-on-desk，均为 MIT）的行为设计：工具执行时对着一台
 * 小电脑打字——球不出现任何手或四肢，只左右摇摆身体模拟敲键盘的节奏，
 * 电脑摆在球前面，屏幕字符闪动。思考冒泡、完成庆祝、闲置入睡同样借自
 * Clawd 的状态机。
 *
 * 球本体仍是自研的 ExpressiveOrb 引擎；本组件只负责姿态与道具，
 * 全部动画走 CSS keyframes，prefers-reduced-motion 下退化为静态姿势。
 */
export type OrbCompanionState = "idle" | "thinking" | "typing" | "celebrate" | "alert" | "sleep";

type OrbCompanionProps = {
  state?: OrbCompanionState;
  /** 表情球直径。 */
  size?: number;
  /** 覆盖球自身的表情；不传时按 state 推导。 */
  mood?: ExpressiveOrbMood;
  label?: string;
};

const MOOD_BY_STATE: Record<OrbCompanionState, ExpressiveOrbMood> = {
  idle: "idle",
  thinking: "thinking",
  typing: "idle",
  celebrate: "success",
  alert: "alert",
  sleep: "idle",
};

export function OrbCompanion({ state = "idle", size = 64, mood, label }: OrbCompanionProps) {
  const reduceMotion = useReducedMotion();
  const orbMood = mood ?? MOOD_BY_STATE[state];
  return (
    <span
      aria-label={label}
      className={`orb-companion orb-companion--${state}${reduceMotion ? " orb-companion--still" : ""}`}
      data-state={state}
      role={label ? "img" : "presentation"}
      style={{ width: size, height: Math.round(size * 1.22) }}
    >
      <span className="orb-companion__orb">
        <ExpressiveOrb active={state !== "sleep" && !reduceMotion} mood={orbMood} size={size} />
      </span>
      {/* 小电脑：打字时摆在球前面，屏幕字符闪动。viewBox 裁到内容边缘，
          让屏幕在同样的盒宽下尽量大。 */}
      <svg aria-hidden="true" className="orb-companion__laptop" viewBox="24 10 72 54">
        <ellipse className="companion-shadow" cx="60" cy="58" fill="rgba(46,26,10,0.15)" rx="36" ry="3.6" />
        <g className="companion-laptop">
          <rect className="companion-laptop__screen" fill="#4A3826" height="37" rx="5" width="54" x="33" y="11" />
          <rect fill="#2E2318" height="30" rx="3" width="48" x="36" y="14.5" />
          <g className="companion-laptop__glyphs" fill="#FFE7C2">
            <rect className="companion-glyph" height="2.8" rx="1.4" width="11" x="40" y="20" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="16" x="40" y="26.5" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="7" x="40" y="33" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="12" x="60" y="26.5" />
            <rect className="companion-glyph" height="2.8" rx="1.4" width="8" x="60" y="33" />
          </g>
          {/* 键盘底座 */}
          <path d="M26 52.5 L94 52.5 L87 49.5 L33 49.5 Z" fill="#6B4E33" />
          <rect fill="#7A5C3E" height="3.6" rx="1.8" width="70" x="25" y="51.1" />
        </g>
      </svg>
      {/* 思考泡泡 */}
      <svg aria-hidden="true" className="companion-float companion-float--think" viewBox="0 0 60 48">
        <circle cx="14" cy="40" fill="var(--surface-strong, #FFF6E8)" opacity="0.9" r="4.5" />
        <circle cx="27" cy="28" fill="var(--surface-strong, #FFF6E8)" opacity="0.75" r="6.5" />
        <circle cx="43" cy="12" fill="var(--surface-strong, #FFF6E8)" opacity="0.6" r="9" />
      </svg>
      {/* 惊叹泡泡 */}
      <svg aria-hidden="true" className="companion-float companion-float--alert" viewBox="0 0 32 32">
        <circle cx="16" cy="16" fill="#E8B34B" opacity="0.95" r="14" />
        <rect fill="#5B3A14" height="13" rx="2.2" width="4.4" x="13.8" y="6" />
        <circle cx="16" cy="23.6" fill="#5B3A14" r="2.2" />
      </svg>
      {/* Zzz */}
      <svg aria-hidden="true" className="companion-float companion-float--zzz" viewBox="0 0 48 40">
        <text fill="#B98A5C" fontFamily="system-ui, sans-serif" fontSize="11" fontWeight="700" x="4" y="34">z</text>
        <text fill="#B98A5C" fontFamily="system-ui, sans-serif" fontSize="15" fontWeight="700" x="18" y="22">Z</text>
        <text fill="#B98A5C" fontFamily="system-ui, sans-serif" fontSize="19" fontWeight="700" x="32" y="10">Z</text>
      </svg>
    </span>
  );
}
