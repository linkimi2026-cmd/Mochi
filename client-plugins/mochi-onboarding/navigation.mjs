const visible = node => node && !node.disabled && node.getClientRects().length > 0 && !node.closest('[hidden],[inert]');
const first = (document, selector) => [...document.querySelectorAll(selector)].find(visible);
export function locateGuideTarget(document, action) {
  const selectors = {
    chat: '[data-slot="sidebar"] button[aria-label="新建会话"],button[aria-label="新建会话"]',
    composer: '[data-conversation-content] [contenteditable="true"]',
    voice: '[data-conversation-content] button[aria-label="开始录音"],[data-conversation-content] button[aria-label="打开语音输入引导"]',
    voicechat: '[data-conversation-content] button[aria-label="开启语音对话"]',
    camera: '[data-conversation-content] button[aria-label="摄像头或展台拍题"]',
    mail: '[data-slot="sidebar.footer.action"] button[aria-label^="小信箱，"]',
    campus: 'button[aria-label="展开校园工作入口"],button[aria-label="收起校园工作入口"]',
    listening: '[data-slot="sidebar.footer.action"] button[data-mochi-classroom-status]',
    planner: '[data-slot="sidebar.footer.action"] button[aria-label="课堂管家"]',
  };
  if (action === 'settings' || action === 'account') {
    const trigger = document.querySelector('[data-slot="settings.trigger"]')?.closest('button');
    return visible(trigger) ? trigger : null;
  }
  return selectors[action] ? first(document, selectors[action]) ?? null : null;
}

export const TARGET_HINTS = {
  chat: '没有找到新建会话按钮，请展开左侧栏后再试。', composer: '当前没有可用输入框，请先打开一个新对话。',
  voice: '当前没有语音输入入口，请先打开对话；若仍没有，检查本地识别服务与插件状态。',
  voicechat: '当前没有语音对话入口，请先打开对话；若仍没有，检查语音对话插件与本地识别服务。',
  camera: '当前没有拍题入口，请先打开对话；若仍没有，检查摄像头插件是否启用。',
  mail: '当前没有小信箱入口，请检查本机校园连接功能是否启用。',
  campus: '校园工作入口还不可用。先登录校园账号，再核对班主任权限与密码设置。',
  listening: '当前没有课堂助手入口，请先确认这是教室端并检查本地监听功能。',
  planner: '当前没有课表入口，请先确认这是教室端并检查课堂管家功能。',
  settings: '没有找到设置入口，请展开左侧栏后再试。', account: '没有找到校园账号入口，请先打开设置的“通用”。',
};
