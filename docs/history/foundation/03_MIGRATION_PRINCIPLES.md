# 03 · 迁移原则（MIGRATION_PRINCIPLES）

> 本文件是硬约束清单。任何 phase 与其冲突时，停下来报告，不许绕过。

## P-0 身份与边界

1. **USE THE REAL HARNESS**：唯一运行底座 = 官方 `mochi-harness@ dsh-v0.1.3-alpha.1`（commit d347e7039）。
   禁止实现第二个 harness / harness-lite / fake-harness / mochi-chat-app。
2. **嘉行联不可重做**：`/Users/a1379/Documents/联动计划` 只读。需要它的东西 → 复制到 Mochi 再改，
   绝不回改原仓（每次交付用 `find 联动计划 -mmin -60` 自证零改动）。
3. **上游友好**：扩展只走 plugin / profile / bundle / client-plugin / slot / patch / configuration。
   非必要不 patch 内核源码；确需 patch 时必须记录在 `32_MIGRATION_RISK_REGISTER.md` 并给出升级方案。

## P-1 产品形态

4. **Harness 功能骨架 + 嘉行联产品皮肤与交互语言**：保留 Trajectory/Session/Plugins/Settings/审批卡
   全部真实结构；教师默认视图可简化展示，但 Advanced 必须可达。
5. **WORK-FIRST**：一级体验围绕任务/步骤/工具调用/审批/Artifacts，不是消息气泡。
6. **角色负责叙事，UI 负责事实**：不做 AI 卡片墙、不做无意义渐变玻璃、不做模板化 SaaS 仪表盘。

## P-2 对话与能力分层

7. **POLICY GOVERNS CAPABILITY. MODEL GOVERNS CONVERSATION.**
   Policy 只做 Authorize/Deny/Redact/Minimize/RequireApproval/RestrictTool；
   不许关键词匹配直接 return 固定话术（Local Rule Direct Return Rate 目标 <5%，`30`）。
8. **TOOLS RETURN FACTS. MOCHI SPEAKS.** 工具返回结构化事实（status/artifact/metadata/warnings/error），
   不返回"好的，已经帮老师做好了"。
9. **普通聊天不挂工具**：改写句子 → 纯模型；"我们班今天怎么样" → 模型决定调 jxl.* → 数据 → 模型汇总。

## P-3 安全与权限

10. **模型永不见密码**：Password/RefreshToken/SessionSecret/OrganizationSecret 只存在主进程/凭据层；
    认证完成后 agent 只获得 Identity/Role/Scope/Capabilities。
11. **A2A 不绕过主人权限**：Requester→Task→Owner Agent→Owner Tools→Owner Permission→Artifact Grant→Requester。
12. **审批是便利闸门不是安全边界**（官方 SAFETY.md 原话）：安全兜底靠 scope+沙箱+服务端权限，
    审批卡负责人在环确认。DENY 判定只按工具名（审批 payload 无参数，官方事实）。
13. **遥测必须关死**：`session-telemetry-otel: mode: DISABLED` + `DSH_TELEMETRY_DISABLED=1` 双保险
    （`disabled: true` 无效，已被实测推翻——12_REVISION_LOG R-B2）。
14. **webserver 只绑 127.0.0.1**（官方无 TLS/认证/同源策略）。

## P-4 工程纪律

15. **版本冻结**：比赛窗口内锁死 `dsh-v0.1.3-alpha.1`；禁 `@latest`；订阅上游 release 但不自动升级。
16. **先地基后功能**：本阶段交付的是 REALITY/ARCHITECTURE/CONTRACT/COMMANDS，不是全量业务代码。
17. **不许编造仓库结构**：未读到的路径一律标 `TO_BE_RESOLVED_DURING_REPO_AUDIT`（`33`）。
18. **幂等优先**：发送/确认/派发/重试都必须幂等（`28`）。
19. **砍刀纪律**：P0 之外全部降级记录在案（38 工具、5 Skill、单机模拟 A2A、无 Episodic 记忆）。
20. **每次交付自证**：联动计划零改动 + dsh 内核 diff 为零（除登记过的 patch）。
