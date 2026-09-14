# 29 · 安全边界（SECURITY_BOUNDARIES）

## 1. 威胁面与对策

| 威胁 | 对策 |
|---|---|
| 模型泄密（prompt 注入让 agent 交凭据） | 凭据永不进模型上下文（`18`）；模型无凭据工具 |
| 审批被当安全边界 | 官方 SAFETY 原话：approval 是便利闸门；硬边界 = scope + 沙箱 + 服务端权限 |
| A2A 越权 | Requester→Task→Owner Agent→Owner Tools→Owner Permission→Grant（`14` §5）；请求方永不见对方文件系统 |
| 恶意/失控工具 | 官方 `tools/pre-execute` 把关 + 沙箱 workspace-write + answerer DENY 名单 |
| 遥测外联 | `session-telemetry-otel: mode: DISABLED` + `DSH_TELEMETRY_DISABLED=1`（`disabled:true` 无效，R-B2）；Wireshark 抽查 |
| webserver 暴露 | 仅 127.0.0.1；禁 0.0.0.0（官方无 TLS/认证/同源策略） |
| Node 版本 | `^22.19.0 || >=24.0.0`；避开 24.0–24.11.1（官方已知启动故障） |
| 外部 Chat 桥 | 默认不采集；仅显式交接；不碰 Token/Cookie（`24`） |
| 供应链 | 办公库 License 审计（GPL 传染排除，无 License=不可用）；`pnpm-lock` 钉死 |
| 本地数据 | 本地 demo 库含虚拟数据；学生敏感字段不进长期记忆（`20`） |

## 2. 沙箱分级使用

- 开发/演示默认 `workspace-write`；
- 只读查询会话可考虑 `read-only` 模式 profile；
- `danger-full-access` 仅允许出现在未签名打包问题的临时排查，验收环境禁止。

## 3. 审计

- 官方审批事件对（approval/asked + approval/decided）+ jxl 调用审计 + Movement 全链审计
  （联动计划既有）三层留痕。
- 答辩可展示：任选一次工具调用，从 Trajectory 还原"模型被告知了什么、哪道闸做的决定"。
