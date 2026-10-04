import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CAMERA_TOOL, createCameraProjection } from './projection.mjs';

export const name = 'mochi-camera';
export const inject = ['tools', 'sessionProjections'];

export function apply(ctx) {
  ctx.sessionProjections.register(createCameraProjection());
  ctx.tools.register(defineTool({
    name: CAMERA_TOOL,
    description: '当用户要求拍题、看摄像头或展台上的题目时，向当前会话提出拍题请求。'
      + '客户端打开设备预览；首次使用需要系统摄像头授权。用户选设备、拍照后，图片进入当前草稿，由用户检查并发送。'
      + '此工具不会读取画面、自动拍照或自动发送；未收到用户图片前不能声称已经看到题目。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (_args, exec) => {
      if (!exec?.agent) throw new Error('当前没有会话，无法请求拍题。');
      return {
        kind: 'camera-preview-request',
        requestId: exec.callId || randomUUID(),
        requestedAt: Date.now(),
        message: '已向当前会话请求摄像头预览。请用户选设备并拍照，检查草稿图片后发送；尚未收到题目图片。',
      };
    },
  }));
}
