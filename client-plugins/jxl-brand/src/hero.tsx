// Mochi 本尊入口：真实 OrbCompanion（球 + 小电脑，Clawd 式状态机）+ ExpressiveOrb 引擎。
// 共享组件由 build.mjs 解析到 canonical 联动计划/src/components；这里仅复用，不另建副本。
// 本文件做：汇总导出 + CSS 注入 + hero mark 适配 + 品牌位组件。

import orbCss from "@jxl-campus-components/ExpressiveOrb.css";
import companionCss from "@jxl-campus-components/OrbCompanion.css";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import jsxRuntime from "react/jsx-runtime"; // 确保模块表基线外部依赖在打包期被标记
import { ExpressiveOrb } from "@jxl-campus-components/ExpressiveOrb";
import { OrbCompanion, type OrbCompanionState } from "@jxl-campus-components/OrbCompanion";

export { ExpressiveOrb, OrbCompanion };

import loadingCss from "@jxl-campus-components/MochiLoading.css";
import { MochiLoading } from "@jxl-campus-components/MochiLoading";
import { createRoot } from "react-dom/client";
/** Mount the compact typing Mochi used for the current running turn only. */
export function mountLoading(el: HTMLElement, text: string, compact = false) {
  injectCompanionStyles();
  const root = createRoot(el);
  root.render(<MochiLoading text={text} compact={compact} />);
  return () => root.unmount();
}

/** Mount the same real Mochi in a non-computing attention state, for approvals. */
export function mountCompanion(el: HTMLElement, state: OrbCompanionState, text: string, size = 30) {
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
export function mountAvatar(el: HTMLElement): void {
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
}

/** 头像状态切换：busy 时 typing 态（摇身体敲键盘），空闲回 idle。 */
export function renderAvatar(root: ReturnType<typeof createRoot>, state: "idle" | "typing"): void {
  root.render(<OrbCompanion state={state} size={26} label="Mochi" />);
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
.jxl-msg-avatar-status{font-size:12px;letter-spacing:.02em;color:#9aa8a0;opacity:0;transition:opacity .25s ease;padding-bottom:8px;}
.jxl-msg-avatar-row--busy .jxl-msg-avatar-status{opacity:1;}
.jxl-msg-avatar-row--busy .jxl-msg-avatar-status::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#e8b34b;margin-right:6px;vertical-align:middle;animation:jxl-pulse 1.2s ease-in-out infinite;}
@keyframes jxl-pulse{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.jxl-msg-avatar-row--busy .jxl-msg-avatar-status::before{animation:none}}
.jxl-pending-mochi{display:flex;align-items:center;pointer-events:none;}
.jxl-pending-mochi--flow{position:relative;z-index:1;align-self:center;flex:none;min-height:34px;margin:0 auto 4px;padding:0 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,var(--dsw-alias-border-l3));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-border-l3) 70%,transparent);}
.jxl-pending-mochi--flow::after{content:"Mochi 正在处理";margin-left:6px;color:var(--dsw-alias-label-secondary,#747c76);font:500 12px/1.2 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;}
.jxl-pending-mochi--approval{justify-content:flex-end;margin:4px 16px 0;min-height:32px;}
/* ApprovalPanel exposes data-approval-scroll; its first direct div is the native reason headline. */
[data-approval-key] [data-approval-scroll] > div:first-child{white-space:pre-line;}
.jxl-skills-row{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);}
.jxl-skills-head{display:flex;flex-direction:column;gap:2px;}
.jxl-skills-title{font-size:13px;font-weight:600;color:inherit;}
.jxl-skills-sub{font-size:11.5px;color:#9aa8a0;}
.jxl-skills-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}
.jxl-skills-item{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.03);}
.jxl-skills-name{font-size:12.5px;font-weight:600;color:inherit;}
.jxl-skills-desc{font-size:11.5px;line-height:1.5;color:#9aa8a0;}
`;
const ALL_CSS = orbCss + "\n" + companionCss + "\n" + loadingCss + "\n" + AVATAR_CSS;

export function injectCompanionStyles(): void {
  if (document.getElementById("jxl-companion-css")) return;
  const el = document.createElement("style");
  el.id = "jxl-companion-css";
  el.textContent = ALL_CSS;
  document.head.appendChild(el);
}

/**
 * 主视觉 slot 适配：官方 hero mark 传 { size, className }。
 * Mochi 本尊 = OrbCompanion（球 + 电脑），不是任何手绘静态球。
 */
export function HeroMochi({ size, className }: { size?: number; className?: string }) {
  const s = Math.max(Number(size) || 34, 48);
  return (
    <span className={`${className ?? ""} jxl-hero-mark`} style={{ display: "inline-flex", alignItems: "flex-end" }}>
      <OrbCompanion state="idle" size={s} label="Mochi" />
    </span>
  );
}

/**
 * 品牌标识 = 水母（嘉行联 logo，jiaxing-jellyfish-v1.png 复制件，经 /jxl-assets 服务）。
 * 注意：水母是 logo，不是 Mochi 本尊。
 */
export function JellyfishBrandMark({ size, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/jxl-assets/brand/jiaxing-jellyfish-v1.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", flexShrink: 0 }}
    />
  );
}

/** 品牌字标：嘉行联 + JXL（与联动计划 Logo.tsx 同构，宋体衬线见主题桥 .jxl-brand-name）。 */
export function JellyfishWordmark() {
  return (
    <span className="jxl-brand-name">
      <span>
        {"嘉行联 "}
        <i className="jxl-brand-en">JXL</i>
      </span>
    </span>
  );
}

/** 「中文（嘉行联）」语言包：fallback=zh，只覆盖需要换装的键。 */
export const HERO_DICT = {
  "hero.headline": "你好，我是 Mochi",
  "hero.preview": "校园工作伙伴",
  "hero.chooseWorkspace": "选择工作区",
};

/** 官方过程视图在「中文（嘉行联）」语言包中的入口名称。 */
export const TRAJECTORY_DICT = {
  "view.trajectory": "查看工作过程",
};

/** 官方运行状态文案：保留状态组件、时钟和 aria-live 语义，只替换品牌文字。 */
export const CHAT_DICT = {
  "chat.deepDiving": "mochi探索中",
};
