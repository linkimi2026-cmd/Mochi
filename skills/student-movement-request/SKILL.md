---
name: student-movement-request
description: 帮授权教师为不舒服的学生代录待审批放行申请，并通过真实人工确认卡完成审批；用户提到学生去医务室、宿舍、放行申请或返班时使用。
whenToUse: 用户要按学生姓名创建、查询或审批放行申请时使用。
user-invocable: true
---

# 学生放行申请

## 创建待审批申请

1. 用户给姓名、学号或班级时，先调用 `jxl.student_directory_search`。`jxl.student_query` 只查流动单，空列表不代表学生不存在。
2. 目录返回唯一学生后，使用其真实 `id` 调用 `jxl.movement_request_create`。若重名或返回多名，先请老师明确选择。
3. `jxl.movement_request_create` 会触发 Mochi 官方 `approval.request` 确认卡。确认前不得声称申请已创建；确认后也只能说申请为 `PENDING`，不能说学生已获准离班。
4. 不得用 Markdown 表格、文字“按钮”或普通回复冒充确认卡。工具没有实际返回时，明确说操作未执行。
5. 创建成功后的普通结果消息没有“批准/拒绝”按钮，不得让老师点击不存在的按钮。要审批时必须继续调用 `jxl.movement_request_decide`；只有该工具执行期间出现的原生 `approval.request` 卡片才可点击。
6. 工具返回 `USER_DECLINED` 表示用户已经拒绝原生确认卡。立即停止本轮，不再索要确认，只报告“已取消，申请未登记”。只有用户之后重新发起，才可再次调用。

## 审批

1. 先调用 `jxl.movement_request_list`，找到真实申请编号和当前版本。
2. 复述学生姓名、班级、代录人、目的地、事由、预计到达时间、申请编号和 `PENDING` 状态。
3. 调用 `jxl.movement_request_decide`。该工具会再次触发官方确认卡；卡片未被点击时不得声称批准或拒绝。
4. 只有 approve 工具成功返回 `APPROVED` 和正式 movement 编号后，才能说已放行。
5. 若确认卡返回 `USER_DECLINED`，只报告审批未执行并结束本轮，不提示再次点击或再次确认。

## 事实边界

- 只使用工具返回的学生、申请和流动记录，不猜 studentId、申请编号或版本。
- 无权限、版本冲突、已有在途记录或查询失败时，原样说明结果，不用文字模拟成功。
- 当前没有学生登录角色，申请来源应明确为授权教师代学生登记。
- 到达、医务处置、离开医务室和返班确认由不同真实账号完成，不能把教师身份当作校医：
  - 校医或宿管按目的地使用 `jxl.movement_transition` 记录 arrive/leave；
  - 校医使用 `jxl.medical_event_create` 创建处置记录、`jxl.movement_link_medical_event` 关联流动单，并用 `jxl.medical_event_status` 依次记录“准备返班”和最终“已返班”；
  - 有权限的教师使用 `jxl.movement_transition` 的 confirm-return 确认返班。
- 每个写工具都有独立原生确认卡。账号角色不符、版本变化或确认卡未获允许时不得继续后续步骤。
