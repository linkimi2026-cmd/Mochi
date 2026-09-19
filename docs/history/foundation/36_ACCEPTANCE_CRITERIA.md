# 36 · 验收标准（ACCEPTANCE_CRITERIA）

## A. UI 验收（实机截图对比，全矩阵）

| 维度 | 要求 |
|---|---|
| 设备 | Desktop / iPhone / Android / Tablet（真实机或精确仿真） |
| 主题 | Light / Dark / Reduced Motion / Reduced Transparency |
| 对比对象 | ① 现有嘉行联网站 ② 真实 dsh Web UI |
| 通过线 | 配色/材质/圆角/字体与嘉行联一致；信息结构/交互与 Harness 一致；**看起来像嘉行联的产品，用起来像真正的 Harness** |
| 红线扫描 | 全矩阵无横向滚动条；有字处皆有圆角容器；无塑料感元素；无策略黑话文案 |

## B. 能力验收（不许"假装存在"）

- [ ] 官方 SPA 功能齐全：Session/审批卡/Trajectory/插件页/Settings→Models/附件
- [ ] Advanced 可达：Trajectory、Plan、Subagent、Schedule、插件清单
- [ ] 模型切换：glm-4-flash ↔ 备用档切换后 P0 冒烟全绿（`10` §4 不变量）
- [ ] 遥测：`--dump-config` 显示 `mode: DISABLED`；抓包无遥测外联；webserver 仅 127.0.0.1
- [ ] 版本：`git log -1` = d347e7039（dsh-v0.1.3-alpha.1）；`pnpm-lock` 提交；无 `@latest`

## C. Agent 行为验收

- [ ] Local Rule Direct Return Rate < 5%（50 条 Eval）
- [ ] Permission Compliance = 100%（越权全 DENY、CONFIRM 全弹卡）
- [ ] CONFIRM 卡内容具体（对象/接收方/用途三要素）
- [ ] 工具返回全为结构化事实（抽查 20 条无聊天话术）
- [ ] 质量循环：PPT create→inspect→edit→verify 链可复现
- [ ] AUTH_REQUIRED → 连接嘉行联 → 重试成功；模型全程不见凭据

## D. Golden Demo 验收（连排，断网可跑）

- [ ] A 传话闭环（对方主人应答）　[ ] B 找卷子→Artifact　[ ] C 换课 ASK
- [ ] D 学生医务（教师代发模拟）　[ ] E 投影仪 REQUEST　[ ] F Chat→Work（可降级选区）
- [ ] G 失败 fallback 链
- [ ] 每场可回放 Trajectory；演示模式与 demo-auto-approver 预案可用

## E. 工程与安全验收

- [ ] `find 联动计划 -mmin -N` 零改动自证（每次交付）
- [ ] dsh 内核 diff 仅登记过的 patch；上游友好（插件/patch/profile 承载全部扩展）
- [ ] 幂等：重复发送/应答/派发抽查通过（`28`）
- [ ] 学生敏感数据不入长期记忆（代码审查 + 用例）
- [ ] Failure Model 错误码全表落地且模型可读（`27`）

## F. 最终裁判标准

评委看到的必须是：**"一套真正运行在完整 Agent Harness 上的教师工作环境"**——
讨论 → 交给 Mochi → 调用工具 → 产出 PPT/Word/Excel/PDF → 访问授权后的嘉行联 →
找其他 Mochi → 派任务 → 获得审批 → 拿回文件 → 继续工作。
而不是"一个做得比较漂亮的 Chatbot"。
