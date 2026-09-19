# 系统提示词参考库（外部对标）

> 用途：Mochi 产品设计的**对标参考**，不参与运行时，不被任何 profile 加载。
> 抓取时间：2026-09-11

## 来源与可信度

| 项 | 值 |
|---|---|
| 仓库 | [`asgeirtj/system_prompts_leaks`](https://github.com/asgeirtj/system_prompts_leaks) |
| commit | `f475e8b2b11ca7540a37234a451e9f085471bd94`（2026-09-09） |
| 规模 | 64,805 stars / 10,642 forks |
| 许可 | CC0-1.0（可自由读改，但**不等于可原样商用**） |
| 抓取脚本 | `scripts/fetch-system-prompts.py`（幂等，可重跑更新） |
| 校验 | `manifest.json` 含每份文件的字节数、行数、sha256 |

**可信度分层（重要）：**

- `Anthropic/official/` 只是第三方仓库的目录命名；本轮未逐份对照厂商原文，真实性与时效性未验证，不能据此标为官方。
- 其余文件 = 社区从线上产品抓包/提取，结构完整但可能滞后线上版本
- 全部**非厂商正式发布物**，仅作研究与自有 Agent 设计参考

本轮官方仓库核对及固定提交见 [复用审计](../../reuse-audit.md#2026-09-15--提示词ppt-视觉复核与评测)。下面清单沿用历史整理者的命名，不代表当前型号或官方发布事实。

2026-09-15补核：Fable 5.1已直接查到Anthropic官方公开system prompt；GPT-5.6 Sol仍仅作为第三方GitHub快照研究。具体来源与落地见 [全领域质量说明](../../agent-quality.md)。这不等于逐份认证下列历史副本。

## 文件清单

### Anthropic — Claude Fable 5.1 全套

| 文件 | 体量 | 内容 |
|---|---|---|
| `Anthropic/official/2026-09-01-claude-fable-5.1.md` | 28 KB / 226 行 | **第三方标称官方，未验证**：产品信息块、拒绝处理、儿童安全条款、版权边界 |
| `Anthropic/claude-fable-5.1.md` | 405 KB / 7810 行 | 线上全量版：含全部工具定义（搜索、Artifacts、记忆、代码执行） |
| `Anthropic/claude-code/claude-code-fable-5.1.md` | 323 KB / 6621 行 | Claude Code 形态：reasoning_effort 档位、工具策略、子代理派发 |
| `Anthropic/claude-code/claude-code-headless-fable-5.1.md` | 198 KB / 4400 行 | 无头/无人值守形态：审批链、非交互执行 |

### Anthropic — Cowork（办公 Agent 桌面形态，⭐ 与 Mochi 最同构）

| 文件 | 体量 | 内容 |
|---|---|---|
| `Anthropic/claude-cowork/claude-cowork.md` | 175 KB / 2503 行 | 办公 Agent 主提示词：产品呈现纪律、工具调用风格、远端设备桥接、触发器、Artifact 交付 |
| `Anthropic/claude-cowork/claude-cowork-dispatch.md` | 72 KB / 696 行 | **Dispatch 编排器**：自己不干活、把请求路由到任务会话；含 auto memory 隐私边界 |

### OpenAI — 面向 Mochi 场景的精选

| 文件 | 体量 | 内容 |
|---|---|---|
| `OpenAI/gpt-5.6-sol.md` | 124 KB / 1845 行 | 旗舰聊天全量：人格、环境、工具、输出格式规则 |
| `OpenAI/Codex/gpt-5.6.md` | 17 KB / 168 行 | Coding Agent 人格与 `commentary`/`final` 双通道协议 |
| `OpenAI/chatgpt-gpt-5-agent-mode.md` | 21 KB / 318 行 | Agent 模式：任务分解与长程执行 |
| `OpenAI/tool-advanced-memory.md` | 6 KB / 220 行 | 记忆工具定义（写入/召回语义） |
| `OpenAI/tool-deep-research.md` | 2.6 KB / 9 行 | 深度研究工具定义 |
| `OpenAI/chatgpt-personality-instructions.md` | 8 KB / 42 行 | 人格档位总纲：正式输出强制中性语气 |
| `OpenAI/gpt-5-{robot,nerdy,listener}-personality.md` | 各 2–3 KB | 三条人格变体（零情绪 / 技术宅 / 倾听者） |

## 与 Mochi 的映射关系

| 参考文件 | Mochi 对应部位 | 可摘什么 |
|---|---|---|
| **`claude-cowork.md`** | **整体骨架 + 产品呈现纪律** | 底座命名残留怎么对外隐藏、工具调用风格的克制写法、远端设备桥接 |
| **`claude-cowork-dispatch.md`** | **mochi-dispatch** | 编排器只路由不执行的话术、任务会话回执、记忆的隐私边界 |
| Fable 5.1 官方快照 | `persona` / 身份与红线 | 身份铁律的写法、拒绝时的措辞纪律、**未成年人相关条款**（Mochi 直接面向学生，这部分最该精读） |
| `claude-fable-5.1.md` | 工具清单与描述 | 工具说明怎么写得让模型会用、Artifacts 与记忆开关的产品化表述 |
| `claude-code-fable-5.1.md` | **Work 模式**（工具型 Agent） | plan/build 边界、子代理派发、破坏性操作需授权的表述 |
| `claude-code-headless-fable-5.1.md` | **A2A 任务与课前预启动** | 无人值守场景下审批闸怎么写、失败怎么回报 |
| `gpt-5.6-sol.md` | **Chat 模式** | 人格 + 环境 + 工具 + 输出格式四段式骨架 |
| `Codex/gpt-5.6.md` | 对话流协议 | 中间过程与最终答复分通道（对应 Mochi 的进度提示与终答分离） |
| `chatgpt-personality-instructions.md` | Mochi 语气 | 闲聊人格与正式产出语气的分离策略（对口 SOUL.md 的语气条） |
| `tool-advanced-memory.md` | 记忆系统（6 工具插件） | 记忆写入/召回的语义边界与触发条件 |
| `chatgpt-gpt-5-agent-mode.md` | 长任务执行 | 多步任务的进度上报节奏 |

## 选型结论：哪一份最适合 Mochi

**主选 = `claude-cowork/`（尤其 `claude-cowork-dispatch.md`）**，理由是同构，不是像：

| 同构点 | Cowork 原文 | Mochi 现状 |
|---|---|---|
| **底层复用 + 对外独立身份** | "Claude is built on top of the Claude Agent SDK, but Claude is NOT Claude Code and should not refer to itself as such. When describing this session or its capabilities, Claude presents the product as Claude (Cowork), never as part of the Claude Code product, **even where internal tool or system names mention Claude Code**" | 底座含 `dsh` / `DeepSeek` 存量命名（白名单 6 项），但对外必须是 Mochi —— 同一道题 |
| **编排器不亲自干活** | "You are the Dispatch orchestrator. You do NOT perform tasks yourself. You route each user request to a dedicated task session using the `start_task` tool" | `mochi-dispatch`（7 态机 + ASK/REQUEST 原语） |
| **首次角色选择** | 工具 `ShowOnboardingRolePicker` | WO-7 教师端/教室端角色弹窗 |
| **定时与课前预启动** | `create_trigger` / `fire_trigger` / `send_later` / `ScheduleWakeup` | 按课表课前预启动 |
| **远程设备 / 教室大屏** | `remote-devices` MCP：`device_bash` / `device_list_dir` / `device_stage_files` / `create_artifact` | 教师端 ↔ 教室端 A2A |
| **该记什么、不该记什么** | auto memory 段含 "What NOT to save in memory"、"Sensitive personal information" | 记忆系统 6 工具插件 + 隐私红线 |
| **产物交付** | `SendUserFile` / `Artifact` | 教学建模五种成果形态 |

**必须剥掉的差异**：Cowork 跑在 Anthropic 云端沙箱、靠桥接访问本机文件，且假定用户用手机/浏览器远程查看；
Mochi 是**本机运行的桌面 App**，教师就在电脑前。抄它的纪律，不要抄它的沙箱假设。

**配套（按用途各取一段，不要整份照搬）：**

| 需求 | 取哪份 |
|---|---|
| 身份、红线、未成年人条款的措辞 | `official/2026-09-01-claude-fable-5.1.md`（226 行，最权威最短） |
| 工具描述该怎么写（46 个工具范例） | `claude-code-fable-5.1.md` 的 `# Tools` 段（从第 326 行起） |
| 中间进度 vs 最终答复的通道分离 | `OpenAI/Codex/gpt-5.6.md`（`commentary` / `final`） |
| 定时自动化的产品化表述 | `OpenAI/gpt-5.6-sol.md` 的 `Namespace: automations` + "When to suggest automations" |
| 记忆写入/召回语义 | `OpenAI/tool-advanced-memory.md` |

**一句话**：骨架抄 Cowork，红线抄官方快照，工具描述抄 Claude Code，通道协议抄 Codex。

## 读法建议（抄结构，不抄全文）

摘四块，改写成 Mochi 自己的话：

1. **角色块** —— 它是谁、服务谁、边界在哪
2. **工具块** —— 每个工具什么时候该用、什么时候不该用
3. **禁止项** —— 硬红线怎么表述才不会被绕过
4. **输出格式** —— 格式规则怎么写得让渲染层不出错

## 免责

- 这些文本的著作权归各厂商，**不得原样搬进 Mochi 的产品提示词或对外交付物**
- 社区提取内容可能滞后或不全，与线上实际行为有差异属正常
- 本目录**只作设计参考**，不进入构建白名单，不被打包
