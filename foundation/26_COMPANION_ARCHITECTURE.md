# 26 · Local Companion 架构（COMPANION_ARCHITECTURE）

## 1. 定位（未来，P4；本阶段只定协议与边界）

Mochi Companion：代表 Mochi 触达本地文件、Office 文档、桌面 App 的**受控执行体**。

## 2. 链路与边界

```
Harness 插件 → Secure Channel（本机 IPC/命名管道，双向鉴权）
  → Companion（最小权限进程）
  → Permission（每次操作白名单 + CONFIRM）
  → Execute → Result（结构化事实回传）
```

- 第一阶段**不开放整台电脑**：默认白名单 = 工作区目录 + 用户显式授予的目录。
- 高影响操作（批量移动/删除/系统设置）一律 CONFIRM 且小批量（≤10 文件/批，失败即停）。
- Companion 永不持有模型凭据；不主动外联。

## 3. 与现状的关系

- 当前办公工具族（ppt/doc/xlsx/pdf/file）直接跑在 Harness workspace 内，**不需要** Companion；
- Companion 只有在需要跨出 workspace（桌面 App、系统级文件）时才启用；
- P4 前只交付：协议文档 + 桩插件（工具存在但返回 `COMPANION_NOT_AVAILABLE`）。
