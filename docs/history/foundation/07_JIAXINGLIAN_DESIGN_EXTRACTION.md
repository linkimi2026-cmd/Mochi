# 07 · 嘉行联设计系统提取（JIAXINGLIAN_DESIGN_EXTRACTION）

> 来源：`联动计划/src/design/*`、`src/lib/motion.ts`、`src/styles.css`（只读提取，原样值）。

## 1. calm-tokens.css（主令牌，74 行完整体系）

### 亮色 `:root`
```css
--canvas:#f5f2e9; --surface:#fcfaf4; --surface-strong:#ffffff; --surface-soft:#eeede5;
--ink:#2d3833; --ink-strong:#17221e; --muted:#747c76; --line:rgba(57,72,63,.12);
--sage-100:#e7ebe4; --sage-200:#c9d0c6; --sage-400:#95a295;
--sage-600:#687a6e; --sage-800:#45584e; --sage-solid:#45584e;   /* 品牌鼠尾草绿 */
--accent:#d9873e; --accent-soft:#f5e5d3;                        /* 暖橙强调 */
--danger:#bf6048; --danger-soft:#f5e2dc; --success:#698c70; --success-soft:#e1ebe0;
--shadow-card:0 8px 24px rgba(50,61,54,.075); --shadow-float:0 16px 40px rgba(43,54,48,.14);
--radius-xs:8px; --radius-sm:12px; --radius-md:16px; --radius-lg:22px; --radius-xl:28px; --radius-pill:999px;
--font-sans:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif;
--font-serif:"Songti SC","STSong","Noto Serif CJK SC",serif;
--font-title:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",…;
--spring:cubic-bezier(.22,.78,.24,1);
--control-radius-icon:15px; --control-radius-compact:14px;
--control-press-duration:90ms; --control-surface-duration:180ms;
--control-top-rim:rgba(255,255,255,.6);
--glass-bg:linear-gradient(145deg,rgba(255,255,255,.9),rgba(255,253,248,.78));
--glass-border:rgba(255,255,255,.55);
--control-shadow-rest:0 2px 8px rgba(29,69,62,.06); --control-shadow-hover:0 4px 12px rgba(29,69,62,.12);
--control-shadow-press:0 1px 3px rgba(29,69,62,.1);
```
### 暗色 `[data-theme="dark"]`（关键反转）
`--canvas:#1b211e; --surface:#242c28; --surface-strong:#2a332e; --surface-soft:#303833;
--ink:#e7ebe7; --ink-strong:#fff; --muted:#aeb8b1; --sage-100:#303b35→--sage-800:#cad5cd（阶梯反转）;
--accent-soft:#4a3527; --glass-bg:linear-gradient(145deg,rgba(30,47,43,.92),rgba(22,40,36,.86));
--glass-border:rgba(255,255,255,.14); 阴影加深(card rgba(0,0,0,.2)/float .35); --control-top-rim:rgba(255,255,255,.14)`

## 2. reference-ui.css（`--rui-*` 参考令牌）

`--rui-canvas:#f7f7f3; --rui-surface:#fff; --rui-subtle:#eef1ed; --rui-ink:#17201c; --rui-line:#dde3de;
--rui-brand:#56ae7f(翠绿); --rui-brand-soft:#eaf4ee; --rui-deep:#315f50(深绿); --rui-warm-ink:#8b4d24;
--rui-alert:#d7675c; --rui-focus:#176b4c; --rui-page-gap:32px; --rui-page-inline:20px(768/1024 断点增至 24/32/40px);
--rui-motion-fast:var(--control-press-duration); --rui-motion-ui:var(--control-surface-duration); --rui-ease:cubic-bezier(.22,.78,.24,1)`
暗色：`--rui-canvas:#191f1c; --rui-brand:#73c598; --rui-deep:#b6dcc7; …`

## 3. cozy-pages.css（手绘/童话辅助）

`--cozy-cream:#f8f3e9; --cozy-paper:#fffdf8; --cozy-sage:#dce5d9; --cozy-sage-strong:#6f806f;
--cozy-peach:#f3d7c6; --cozy-butter:#f5e6bc; --cozy-rose:#eed8d5; --cozy-ink:#2c342f;
--cozy-pencil:#7f8178; --cozy-hairline:rgba(74,74,60,.12); --cozy-shadow:0 12px 34px rgba(69,66,52,.08)`（暗色成套反转）

## 4. 动效（src/lib/motion.ts，TS 单一真理源）

- 缓动：`--ease-default:cubic-bezier(.25,.1,.25,1)` + in/out/in-out/linear（Apple 公开值）。
- 时长：`--dur-control:100ms; --dur-toggle:200ms; --dur-implicit:250ms; --dur-ease:350ms; --dur-push:350ms; --dur-sheet:450ms`。
- Spring 预设（response s/阻尼比）：default .55/1.0、spring .5/.825、interactive .15/.86、drawer .45/.9、
  toastExit .35/1.0、navPress .45/.72、fab .5/.8；真实 mass-spring-damper 解析解 + WAAPI 封装 +
  松手速度投影 `projectVelocity()`。

## 5. 组件语汇

- 液态玻璃控件：`LiquidGlassButton`、`Pill`、`SquircleAnchor`、`MaterialSurface`。
- 布局：`Layout`（侧栏/底导航/导航 spring pill）、`NavIcons`、`AssistantDock`、`PainterlyPageFrame`、
  `LiquidToast`、`CursorLight`、`AmbientLeaves`。
- 无集中字号/间距令牌（字面值写在组件样式中，styles.css 1511 行）→ 迁移时为 Mochi 建立
  `--jxl-fs-*`/`--jxl-space-*` 补齐阶梯（小增量，不算重新设计）。

## 6. ExpressiveOrb（品牌之魂，整文件迁移）

- 文件：`ExpressiveOrb.tsx`(413 行)/`.css`；接口 `{size=48, mood, active=true, interactive=true, label?, className?}`。
- 六情绪 `idle|thinking|listening|speaking|success|alert`；`TUNING` 每态调参（眼睛/抬升/噪声/呼吸）；
  `MOOD_COLOR` 焦糖暖土带（idle #a06a32 / speaking #c9913c / alert #a24f28，色相 19–45°）。
- 机制：SVG + 单实例 rAF、Catmull-Rom 有机轮廓、阻尼弹簧积分、逐帧 lerp 形变、18% 双眨、
  戳按果冻回弹、`prefers-reduced-motion` 静帧。
- 迁移规则：不改渲染逻辑；`mood` 由 dsh 事件桥驱动（`09` §4）；气质延伸到 Mochi UI 文案与状态卡。

## 7. 交互哲学（UI_MOTION_AUDIT.md 基线）

内容层用实体表面；玻璃只用于控制层（侧栏/顶栏/浮层）；按压即时反馈；拖动 1:1 跟随后交弹簧；
循环装饰动画停用（动画只解释状态变化）；`prefers-reduced-motion`/`reduced-transparency` 降级；
逐页无横向溢出；六岗位场景全覆盖。
