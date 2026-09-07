# MOCHI-P5-MEM-03 · 记忆插件整合：工具注册（不接 runtime-profile，由监制统一收尾）

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 前置：MEM-01（world-state.mjs）、MEM-02（mem-store.mjs）已验收，API 冻结，不得修改这两个文件。
> 边界：只允许新建三个文件：`plugins/mochi-memory/index.mjs`、`plugins/mochi-memory/package.json`、`plugins/mochi-memory/test.mjs`。**禁止**改 runtime-profile.json / 其他任何文件 / npm install / 重启服务 / git 操作。

## 目标

把已验收的两层存储包成 dsh 插件，注册 4 个对话工具。记忆是本地低风险读写，**不走审批闸**。

## 插件模式（严格照抄 `plugins/mochi-dispatch/index.mjs` 与 `package.json`）

- `import { defineTool } from '@deepseek-ai/dsh-tools'`
- `export const name = 'mochi-memory'`、`export const inject = ['tools']`
- `export const output = { schema: {type:'object',additionalProperties:true}, render: (_args, value) => [{type:'text',text:JSON.stringify(value)}] }`
  （⚠️ render 必须双参 (args, value)——单参会把调用参数当结果给模型，大坑 17）
- `export function apply(ctx)`，用 `ctx.tools.register(defineTool({name, description, parameters, output, execute}))`
- package.json：照 dispatch（name/version/private/type:module/main:index.mjs/scripts.test/deps `@deepseek-ai/dsh-tools: 0.1.3-alpha.1`），并照 dispatch 建 `node_modules.nosync/@deepseek-ai/dsh-tools` 相对符号链接 + `node_modules -> node_modules.nosync`（看 dispatch 目录结构照抄，让 test.mjs 能解析依赖）

## 工具（4 个，描述即纪律，模型靠描述决策）

1. **mochi.memory_note** — 写长期记忆。描述必须写死写入纪律（Memory Confidence）：**只在三种情况写**：①主人明确表达长期偏好（"我以后都要…""记住我…"）②同一偏好多次稳定重复 ③主人主动要求记住。一次性闲聊、成绩明细、医疗、密码令牌、私人文件全文**绝不写入**（存储层还有正则护栏会拒）。参数：kind(enum: preference/task_fact/org_knowledge/convention)、content、summary?、importance?(0-1)。执行：mem-store.note + world-state.appendEvent({kind:'memory-note'}) 审计；kind=convention 时同步 setConvention 进 world-state。
2. **mochi.memory_recall** — 检索记忆。参数：query、topK?。返回 store.recall 结果，每条带「为什么Mochi知道这个」（来源+时间+召回次数）；tightened=true 时如实说明（"近期记忆引用率低，已收紧检索范围"）。
3. **mochi.memory_forget** — 忘记一条。参数：id。主人说"忘掉/别记了"时用。返回被忘快照。
4. **mochi.memory_world** — 工作状态快照。参数：action(enum: read/append-todo/complete-todo/append-change/set-convention)、text?。read 返回 world-state.md 全文；描述写明：跨天开始工作时先 read 恢复上下文。

每个工具的 execute 返回**预消化中文摘要**（照 dispatch 的 taskBrief 思路：中文字段名、直接可读，不甩原始 JSON）。

## 测试（test.mjs）

桩 ctx（捕获 register 的工具表）+ mkdtemp 隔离 DSH_HOME：
① 四工具注册齐全、名字正确
② note→recall→forget 全链（中文查询命中、forget 后查不到）
③ 敏感内容被护栏拒绝且错误话术以【未写入】开头
④ convention 同步进 world-state
⑤ render 签名回归：`output.render({some:'args'}, {real:'result'})` 文本含 result 不含 args（大坑 17 回归）
⑥ world read/append-todo/complete-todo

运行：`cd /Users/a1379/Documents/Mochi/plugins/mochi-memory && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test.mjs`

## 交付

三个文件 + 测试全绿。汇报：文件清单、测试输出末尾、偏差（应为零）。200 字内。
**卡死两轮就汇报现状，不无限重试。**
