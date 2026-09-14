# 10 · 模型无关性（MODEL_INDEPENDENCE）

## 1. 原则

模型可以换，Mochi 不能散架。Tools/Skills/Memory/Mochi Network/Artifact/嘉行联/权限与模型解耦；
模型只是 Processor（CONTEXT BELONGS TO MOCHI）。

## 2. 官方机制（不重复造模型系统）

- 模型适配器 seam：`ctx.llm`；自定义 provider 走 `ctx.llm.registerAdapter`（`docs/cookbook/adding-an-llm-adapter.md`）。
- 内置两条路：`deepseek-official`（`dsh-llm-deepseek`，**`baseURL` 可指向 OpenAI 兼容网关**——glm-4-flash 接法，
  本项目已实测）+ `llm-pi-ai` catalog（openai/anthropic/gateway 多协议）。
- Web UI Settings→Models：配 key 即时生效无需重启；`/model` 式切换是官方能力（用户已确认"加入自定义就可以了"）。
- 上轮实测选型结论：`glm-4-flash` 工具调用率 100%；`glm-4.7-flash` 限流下仅 22%（保留为兜底档）。

## 3. 档位策略

| 阶段 | 模型 | 说明 |
|---|---|---|
| 日常开发 | glm-4-flash（免费档） | 用户明确不换付费模型 |
| 复杂联调 | 中等模型（4.7-flash 或同级） | 按需切换 |
| 正式答辩 | 更强更稳模型 | 临时切换，Tools/Skills/数据不变 |

## 4. 不变量（Eval 必查）

- 换模型后：jxl.* 工具可被发现与正确调用；审批三档行为一致；Artifact 流程一致；
  Handoff Capsule 消费一致；人格一致（system prompt 片段不随模型变）。
- `llm-probe.mjs`/`model-probe.mjs`（tools/）继续作为探针；模型换挡跑一遍 P0 Eval 冒烟（`30`）。
- 禁止：把产品能力做进某个模型的专属特性；per-turn 动态路由（已砍，见 12_REVISION_LOG）。
