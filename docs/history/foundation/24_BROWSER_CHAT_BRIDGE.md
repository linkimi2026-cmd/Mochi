# 24 · Browser Chat Bridge（BROWSER_CHAT_BRIDGE）

> P3。成本策略：Chat 调用量大，允许老师在 Harness 内受控浏览器里使用外部合法免费 Chat Provider
> （自行登录自己的账号）；成本不由 Mochi 的模型额度承担。

## 1. 边界（硬约束）

**只做：**
- 用户主动点击"交给 Mochi"后，读取**用户本人有权查看**的当前会话内容；
- 优先级：Provider Adapter（结构化）> DOM/Accessibility Tree；
- 用户框选文字直接交给 Mochi（Selected Text Handoff 兜底，永不做坏）。

**绝不：**
- 绕过外部站点登录、读取无权限数据、偷 Token/Cookie；
- 后台持续监控聊天、截图 OCR 优先、触碰服务商后台数据。

## 2. 捕获设计

```
Browser Chat Bridge
├── Provider Adapter A/B/C（各站点 DOM→统一结构）
├── Generic Selection Adapter（选区捕获，永远可用）
└── 输出：ChatTranscript { messages:[{role, content, timestamp?, source}], capturedAt }
```
- 外部站点 DOM 结构**不泄漏**进 Work Runtime——Adapter 输出统一 ChatTranscript 才过桥。
- 适配器坏 = 该 Provider 降级为选区模式，Demo 不至全灭。

## 3. 范围选择

用户可选：整个当前会话 / 最近 N 轮 / 从这里开始 / 仅选中内容。长对话不无脑塞 100 轮
（超限触发 Handoff Compiler 摘要，`25` §2）。
