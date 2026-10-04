// Existing package identity preserves composition and legacy session compatibility.
import { createProjectionDefinition, orderConversationSchemas } from './modes.mjs';

export const name = 'mochi-modes';
export const inject = ['tools'];

export function apply(ctx) {
  // Tools come from the selected role/preset. Permissions and per-tool approvals
  // keep their own official policy; this plugin neither restricts nor grants them.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: 'mochi:capabilities',
      order: scope.systemPrompt.getSectionOrder('PLAN_POLICY') + 1,
      text: '当前产品已取消工作／对话模式区分。按用户任务使用当前角色与场景实际提供的工具；历史消息中的模式切换要求已不适用，不要请求切换模式。每项操作继续遵守原有权限、审批和安全边界，取消模式切换不代表用户批准了具体操作。',
    });
  });

  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next();
    try {
      if (!assembled || !Array.isArray(assembled.tools)) return assembled;
      return { ...assembled, tools: orderConversationSchemas(assembled.tools) };
    } catch (error) {
      ctx.logger?.warn?.(`[mochi-modes] 工具排序失败，保留原 assembly：${error instanceof Error ? error.message : String(error)}`);
      return assembled;
    }
  }, { global: true });

  // Keep stateVersion 2 and its original fold. Cached chat projections and old
  // command/approval events remain readable, but are never permission input.
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(createProjectionDefinition());
  });
}
