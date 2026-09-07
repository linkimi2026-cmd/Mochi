# 20 · 记忆架构（MEMORY_ARCHITECTURE）

## 1. 层次与载体

| 层 | 内容 | 载体 | 生命周期 |
|---|---|---|---|
| Conversation Memory | 当前会话上下文 | 官方 session 日志 + compaction | 会话级（resume 可续） |
| Working Memory | 跨会话待办/"刚才那个"指代 | `mochi-memory` 插件，本地 sqlite | 天级 TTL |
| Teacher Profile | 学科、班级、称谓、偏好格式 | `mochi-memory`，显式可编辑 | 长期，用户可见可删 |
| Organization Knowledge | 班级/课表等结构化常识 | 嘉行联 API 查询（不复制入库） | 实时 |
| Episodic Memory | — | **v1 砍**（12_REVISION_LOG P1-7） | — |

## 2. 隐私边界（硬约束）

- 学生敏感数据**不允许无限期进入长期记忆**：姓名/健康/流动记录只做 Working Memory（TTL ≤ 24h），
  不写入 Teacher Profile；Profile 仅存教师自身偏好。
- Scope：memory 检索按当前会话 scope 过滤（班主任换班后旧班敏感记忆不跟进）。
- Retrieval Policy：默认只注入 Working Memory 摘要 + Profile，不批量注入历史敏感事件。
- 用户可在 Settings 查看并清除全部本地记忆（jxl-settings 页）。

## 3. 机制

- 写入：经会话事件（模型可见即已记录）；`mochi-memory` 从事件流提取待写入事实（CONFIRM 级别的
  "记住 XX"类请求 → 写 Profile）。
- 读取：系统提示注入摘要（受 token 预算约束）；不作为工具让模型翻库（v1）。
