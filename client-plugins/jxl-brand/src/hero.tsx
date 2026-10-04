export { installHolidayGreeting, subscribeHolidayHome } from "./holiday-greeting.mjs";
export { registerMochiTeam } from "./MochiTeam";
export { teamPalette } from "./team-palette.mjs";
// Mochi 本尊入口：OrbCompanion（球 + 小电脑）+ ExpressiveOrb 连续动效。
// 投产对话界面在本插件内维护一份组件源码。
// 本文件做：汇总导出 + CSS 注入 + hero mark 适配 + 品牌位组件。

import orbCss from "./ExpressiveOrb.css";
import companionCss from "./OrbCompanion.css";
import teamCss from "./MochiTeam.css";
import { useEffect, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import jsxRuntime from "react/jsx-runtime"; // 确保模块表基线外部依赖在打包期被标记
import { ExpressiveOrb } from "./ExpressiveOrb";
import { OrbCompanion, type OrbCompanionState } from "./OrbCompanion";

export { ExpressiveOrb, OrbCompanion };

import loadingCss from "./MochiLoading.css";
import { MochiLoading } from "./MochiLoading";
import { createRoot } from "react-dom/client";
/** Mount the compact typing Mochi used for the current running turn only. */
export function mountLoading(el: HTMLElement, text: string, compact = false) {
  injectCompanionStyles();
  const root = createRoot(el);
  root.render(<MochiLoading text={text} compact={compact} />);
  return () => root.unmount();
}

/** Mount the same real Mochi in a non-computing attention state, for approvals. */
export function mountCompanion(el: HTMLElement, state: OrbCompanionState, text: string, size = 40) {
  injectCompanionStyles();
  const root = createRoot(el);
  root.render(<OrbCompanion state={state} size={size} label={text} />);
  return () => root.unmount();
}

/**
 * 对话区头像：把 Mochi 本尊（idle 态 OrbCompanion，球 + 小电脑）挂到
 * 助手消息行（flowItem[data-chat-flow-kind="assistant-step"]）的左上，
 * 让老师在对话流里随时看到「是 Mochi 在说这句话」。
 * 观察与防重逻辑在 build.mjs 的 apply 模板里，本函数只负责挂载一次。
 * 状态文字只写给官方流式中的当前 assistant，模板通过 SessionSnapshot 和
 * AssistantMarkdown[data-streaming] 定位它；OrbCompanion 的表情态由 renderAvatar 重渲染切换。
 */
export function mountAvatar(el: HTMLElement): () => void {
  injectCompanionStyles();
  const row = document.createElement("div");
  row.className = "jxl-msg-avatar-row";
  const mount = document.createElement("span");
  mount.className = "jxl-msg-avatar-mount";
  const status = document.createElement("span");
  status.className = "jxl-msg-avatar-status";
  row.appendChild(mount);
  row.appendChild(status);
  el.insertBefore(row, el.firstChild);
  const root = createRoot(mount);
  renderAvatar(root, "idle");
  (row as unknown as { __jxlAvatarRoot: ReturnType<typeof createRoot> }).__jxlAvatarRoot = root;
  return () => {
    root.unmount();
    if (row.parentNode) row.parentNode.removeChild(row);
    el.removeAttribute('data-jxl-mochi-avatar');
  };
}

/** 头像状态切换：busy 时 typing 态（摇身体敲键盘），空闲回 idle。 */
export function renderAvatar(root: ReturnType<typeof createRoot>, state: OrbCompanionState): void {
  root.render(<OrbCompanion state={state} size={44} label="Mochi" />);
}

/** 老师常用技能清单（与 /skills 目录一一对应，中文名 + 一句话简介）。 */
export const SKILLS: { name: string; desc: string }[] = [
  { name: "教师晨报", desc: "课间 30 秒扫完的校园晨报：医务室、宿舍、通知与未读消息概况。" },
  { name: "学生跟进", desc: "核对学生近期状态、整理跟进重点、起草给家长或校医的沟通内容。" },
  { name: "班级周报", desc: "汇总一周流动、医务、宿舍与消息处理，生成表格与 Word 报告。" },
  { name: "班会备课", desc: "准备班会目标、大纲、讲稿与课件，并做创建后自检修订。" },
  { name: "教学材料查找", desc: "从工作区与可用资料源寻找、筛选并整理课件、教案与素材。" },
  { name: "Mochi 行事准则", desc: "Mochi 的人格与底线：如实报告工具结果，绝不编造校园状态。" },
];

/**
 * 设置 · 通用里的一行（settings.general.item 槽）：嘉行联技能清单。
 * 用户要求：设置里单独出一个 skill 行列，全部中文并附简介。
 */
export function SkillsRow() {
  return (
    <div className="jxl-skills-row">
      <div className="jxl-skills-head">
        <span className="jxl-skills-title">技能</span>
        <span className="jxl-skills-sub">老师常用的工作技能 —— 对话时说出需求，Mochi 会自动使用</span>
      </div>
      <ul className="jxl-skills-list">
        {SKILLS.map((s) => (
          <li key={s.name} className="jxl-skills-item">
            <span className="jxl-skills-name">{s.name}</span>
            <span className="jxl-skills-desc">{s.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const AVATAR_CSS = `
.jxl-msg-avatar-row{display:flex;align-items:flex-end;gap:8px;margin:2px 0 4px;}
.jxl-msg-avatar-row .orb-companion{flex-shrink:0;}
.jxl-msg-avatar-status{font-size:12px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#706b60);opacity:0;transition:opacity .25s ease;padding-bottom:8px;}
.jxl-msg-avatar-row--busy .jxl-msg-avatar-status{opacity:1;}
@keyframes jxl-pulse{0%,100%{opacity:.4}50%{opacity:1}}
.jxl-pending-mochi{display:flex;align-items:center;pointer-events:none;}
.jxl-pending-mochi--flow{position:relative;z-index:1;align-self:flex-start;flex:none;min-height:56px;margin:8px 0;padding:0;}
.jxl-pending-mochi--flow::after{content:"Mochi 正在处理";margin-left:6px;color:var(--dsw-alias-label-secondary,#747c76);font:500 12px/1.2 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;}
/* rc2 RunningStatus owns its clock and live announcement; only replace its decorative icon. */
[data-chat-running] > span:last-child > span[aria-hidden="true"]{display:none;}
.jxl-pending-mochi--status{display:inline-flex;align-self:center;order:-1;flex:none;width:28px;height:28px;margin:0;}
.jxl-pending-mochi--approval{justify-content:flex-end;margin:4px 16px 0;min-height:32px;}
/* ApprovalPanel exposes data-approval-scroll; its first direct div is the native reason headline. */
[data-approval-key] [data-approval-scroll] > div:first-child{white-space:pre-line;}
.jxl-skills-row{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);}
.jxl-skills-head{display:flex;flex-direction:column;gap:2px;}
.jxl-skills-title{font-size:13px;font-weight:600;color:inherit;}
.jxl-skills-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary,#706b60);}
.jxl-skills-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}
.jxl-skills-item{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.03);}
.jxl-skills-name{font-size:12.5px;font-weight:600;color:inherit;}
.jxl-skills-desc{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#706b60);}
`;
/**
 * 主视觉 slot 适配：官方 hero mark 传 { size, className }。
 * Mochi 本尊 = OrbCompanion（球 + 电脑），不是任何手绘静态球。
 */
export function HeroMochi({ size, className }: { size?: number; className?: string }) {
  const s = Math.max(Number(size) || 72, 72);
  const [sleeping, setSleeping] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setSleeping(false);
      clearTimeout(timer);
      timer = setTimeout(() => setSleeping(true), 45_000);
    };
    wake();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  return (
    <span className={`${className ?? ""} jxl-hero-mark`} style={{ display: "inline-flex", alignItems: "flex-end" }}>
      <OrbCompanion state={sleeping ? "sleep" : "idle"} size={s} label="Mochi" />
    </span>
  );
}

/** 侧栏使用用户提供的 Mochi 图形；颜色跟随浅/深主题。 */
export function MochiBrandMark({ size, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${className ?? ""} mochi-brand-mark`}
      style={{ width: size ?? 24, height: size ?? 24, flexShrink: 0 }}
    />
  );
}

/** Product wordmark; school identity belongs in the profile. */
export function JellyfishWordmark() {
  return <span className="jxl-brand-name">Mochi</span>;
}

const STARTER_PROMPTS = [
  { label: "课堂整理", text: "帮我整理这节课的重点，做成简明的复习提纲。" },
  { label: "师生沟通", text: "帮我写一条自然、礼貌又说清重点的沟通消息。" },
  { label: "梳理下一步", text: "我遇到一件事……请帮我理清情况，再给出下一步建议。" },
] as const;

/** Blank-chat examples write into the native DSH composer draft. */
export function ChatStarterPrompts({
  session,
  input,
  inputActions,
}: {
  session: { blank: boolean; promptAttempted: boolean; awaitingFirstTurn: boolean };
  input: { draft: string; attachmentIds: readonly unknown[]; phase: string };
  inputActions: { setDraft(text: string): void };
}) {
  if (
    !session.blank ||
    session.promptAttempted ||
    session.awaitingFirstTurn ||
    input.draft !== "" ||
    input.attachmentIds.length > 0 ||
    input.phase !== "plain"
  ) return null;

  return (
    <details className="jxl-starter" aria-label="Mochi 对话示例">
      <summary className="jxl-starter__head">
        <span className="jxl-starter__title">看看示例消息</span>
        <span className="jxl-starter__hint">选择后可编辑，再发送</span>
      </summary>
      <div className="jxl-starter__grid" role="group" aria-label="选择一条示例消息">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt.label}
            className="jxl-starter__button"
            type="button"
            aria-label={`填入聊天框：${prompt.text}`}
            onClick={() => inputActions.setDraft(prompt.text)}
          >
            <span className="jxl-starter__label">{prompt.label}</span>
            <span className="jxl-starter__text">{prompt.text}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

const STARTER_CSS = `
.jxl-starter{width:100%;max-width:var(--dsh-composer-card-max-width,720px);margin:0 auto;padding:0 4px 8px;box-sizing:border-box;color:var(--dsw-alias-label-secondary);font:13px/1.5 system-ui,sans-serif;}
.jxl-starter__head{cursor:pointer;padding:6px 0;}
.jxl-starter__title{font-weight:500;}
.jxl-starter__hint{display:none;margin-left:14px;font-size:12px;color:var(--dsw-alias-label-tertiary);}
.jxl-starter[open] .jxl-starter__hint{display:inline;}
.jxl-starter__grid{display:flex;flex-direction:column;padding:4px 0 8px;}
.jxl-starter__button{display:grid;grid-template-columns:88px 1fr;gap:12px;padding:10px 8px;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;}
.jxl-starter__button:hover{background:var(--dsw-alias-interactive-bg-hover);}
.jxl-starter__button:active{background:var(--dsw-alias-bg-layer-3);}
.jxl-starter__button:focus-visible,.jxl-starter__head:focus-visible{outline:2px solid var(--dsw-alias-brand-text);outline-offset:2px;}
.jxl-starter__label{font-weight:500;color:var(--dsw-alias-label-primary);}
.jxl-starter__text{font-size:12px;}
@media(max-width:560px){.jxl-starter__hint{display:none!important}.jxl-starter__button{grid-template-columns:1fr;gap:4px;}}
`;

const ALL_CSS = orbCss + "\n" + companionCss + "\n" + loadingCss + "\n" + AVATAR_CSS + "\n" + STARTER_CSS + "\n" + teamCss;

export function injectCompanionStyles(): void {
  if (document.getElementById("jxl-companion-css")) return;
  const el = document.createElement("style");
  el.id = "jxl-companion-css";
  el.textContent = ALL_CSS;
  document.head.appendChild(el);
}

/** 「中文（嘉行联）」语言包：fallback=zh，只覆盖需要换装的键。 */
export const HERO_DICT = {
  "hero.headline": "你好，我是 Mochi",
  "hero.preview": "校园工作伙伴",
  "hero.chooseWorkspace": "选择工作区",
  "placeholder.default": "直接告诉 Mochi 你需要什么…",
  "placeholder.hero": "直接给 Mochi 发条消息…",
};

/** 官方过程视图在「中文（嘉行联）」语言包中的入口名称。 */
export const TRAJECTORY_DICT = {
  "view.trajectory": "查看工作过程",
};

/** 官方运行状态文案：保留状态组件、时钟和 aria-live 语义，只替换品牌文字。 */
export const CHAT_DICT = {
  "settings.transcript.normal": "完整",
  "settings.transcript.compact": "简洁",
  "chat.deepDiving": "Mochi 探索中",
  "chat.deepDivingFor": "Mochi 探索中，用时 {duration} ···",
};

export const SESSION_EXPORT_DICT = {
  "header.action": "会话记录",
  "dialog.preparingTitle": "正在导出会话",
  "dialog.preparingDescription": "正在整理当前会话、子任务和附件。",
  "dialog.successTitle": "会话记录已开始下载",
  "dialog.successDescription": "正在下载会话记录压缩包。",
  "dialog.errorTitle": "会话导出失败",
  "dialog.commandFailed": "无法启动会话导出。",
};
