export const STEP_IDS = ['identity', 'account', 'chat', 'input', 'mail', 'work', 'settings'];
export const GUIDE_VERSION = 2;
export function guideSteps(role) {
  const teacher = role === 'teacher', classroom = role === 'classroom';
  return [
    { id: 'identity', title: teacher ? '先让 Mochi 认识你' : classroom ? '先认识这个班的小伙伴' : '先确认身份与称呼', sketch: 'pair',
      text: teacher ? '在“设备与连接”填写你希望 Mochi 怎么称呼你，再核对学校与本机教师身份。称呼可以随时改。' : classroom ? '在“设备与连接”填写班级称呼，再核对学校、班级与教室身份。教师个人称呼在教师端填写。' : '本机角色由桌面锁定。到“设备与连接”确认身份和称呼，资料暂时不足也可以稍后补。',
      note: '填写称呼不等于校园账号已认证。', actions: [['identity', '设置称呼与身份']] },
    { id: 'account', title: '登录真正的校园账号', sketch: 'pair', text: '打开设置里的“登录校园账号”。在实际登录页面验证账号；忘记密码或权限不符时，按学校的账号流程处理。',
      note: '指南不会替你登录，也不会把看过这一步当作认证成功。', actions: [['account', '找到校园账号入口']] },
    { id: 'chat', title: '先从一个新对话开始', sketch: 'input', text: teacher ? '新对话默认使用通用 Mochi。备课与课件、资料与试卷、成绩分析、班级与教室四个专门助手按需要选择；切换不会替你发送消息。' : '先在新对话里告诉 Mochi 你想做什么。写好后再点发送；遇到内容不准确，可以继续补充或纠正。',
      note: '已有对话的内容会保留；这里只打开软件原有的新建会话入口。', actions: [['chat', '打开新对话']] },
    { id: 'input', title: '选一种合适的输入方式', sketch: 'input', text: '文字、“语音输入”和“拍题”先放进草稿，检查后再发送。“语音对话”需主动开启，会把识别内容提交当前对话，结束后停止。',
      note: '首次使用麦克风或摄像头需系统授权。没有当前会话时，先新建一个对话。', actions: [['composer', '找到输入框'], ['voice', '找到语音输入'], ['voicechat', '找到语音对话'], ['camera', '找到拍题按钮']] },
    { id: 'mail', title: '从小信箱看一封真实纸条', sketch: 'letter', text: '打开“小信箱”查看通知和回执。设备配对先核对学校、对方身份与指纹；附近发现、已配对和实际送达是不同状态。',
      note: teacher ? '需要发送通知时，在对话中说明班级与内容，由 Mochi 展示后确认。' : '教室收到教师配对申请后，核对无误再接受；可以把屏上的临时代码告诉老师。', actions: [['mail', '打开小信箱']] },
    { id: 'work', title: teacher ? '按校园权限进入工作' : classroom ? '准备好一节课的陪伴' : '找到本机的工作入口', sketch: 'letter',
      text: teacher ? '登录且具备相应权限后，展开“校园工作”进入实际事务页面。先看当前状态，再按页面提示处理；没有入口时先检查账号权限。' : classroom ? '在“课堂助手”查看本地监听状态，说“开始上课”收集本节内容、说“这节课结束”生成可编辑信件；在“课堂管家”导入课表并检查时间。' : '身份服务尚未提供锁定角色。请先回“设备与连接”核对；入口不可用时指南会明确说明。',
      note: teacher ? '登录、授权和提交都在原页面完成，指南不代替这些结果。' : '课表与识别模型需实际准备好；软件关闭或关机期间不会执行提醒。',
      actions: teacher ? [['campus', '找到校园工作']] : classroom ? [['listening', '打开课堂助手'], ['planner', '打开课表']] : [['identity', '核对本机身份']] },
    { id: 'settings', title: '把 Mochi 调成喜欢的样子', sketch: 'letter', text: '设置里可以调整外观与 Mochi 本体颜色。记忆回看只展示实际保存的资料；称呼、班级特质和陪伴开始日期都可回原入口修改。',
      note: '首次七步完成后不再自动出现。想重新看，点侧栏的“新手指引”。', actions: [['settings', '打开设置'], ['memory', '打开记忆回看']] },
  ];
}

export function normalizeProgress(snapshot) {
  const value = snapshot?.value;
  const current = value?.version === GUIDE_VERSION;
  return { ready: snapshot?.status === 'ready', persistent: snapshot?.mode === 'host' && snapshot?.writable === true,
    status: current && value?.status === 'complete' ? 'complete' : 'new',
    step: current && STEP_IDS.includes(value?.step) ? value.step : STEP_IDS[0] };
}

export function guideGeometry({ width, height, composerTop, headerBottom = 64 }) {
  const top = Math.max(16, headerBottom + 14), bottom = Math.min(height - 20, Number.isFinite(composerTop) ? composerTop - 12 : height - 160);
  return { top, right: 18, width: Math.max(140, Math.min(300, width - 36)), maxHeight: Math.max(0, Math.min(470, bottom - top)), hidden: bottom - top < 90 };
}
