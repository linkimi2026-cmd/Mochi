// mochi-visuals · 视觉/绘图工具族插件（cordis 风格 ESM）。
//
// 工具：image_find / image_edit / diagram_draw / teaching_image_match
//   —— 工具名只允许 [a-zA-Z0-9_-]。带点的 `image.edit` 会被模型网关 400
//      拒收整轮对话（2026-09-12 真实事故）。四个名字必须一字不差。
//
// 能力边界（不吹）：
//   * image_find 只读文件头判断格式与尺寸，不修改任何文件，不跟随符号链接。
//   * image_edit 用 @napi-rs/canvas 真解码、真改像素、真编码；产物一律是新文件，
//     绝不覆盖原图；canvas 不可用时如实报错，不做任何伪装。
//   * diagram_draw 用纯 SVG 生成图表（坐标轴/刻度/网格线/图例/数据标签），
//     PNG 由同一份 SVG 光栅化而来，矢量与位图版式一致。
//   * teaching_image_match 只读本机教材索引；本地没有就明确说“本地无匹配”，
//     不联网找图、不伪造“教材原图”，联网只作为未执行的文字建议给出。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createVisualTools, DIAGRAM_TYPES, IMAGE_EXTENSIONS } from './tools.mjs';

export const name = 'mochi-visuals';
export const inject = ['tools', 'sandboxPolicy'];

// ⚠️ render 签名是 (args, value)：第一个参数是调用参数，第二个才是工具返回值。
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

export function apply(ctx, options = {}) {
  const handlers = createVisualTools({ ctx, options });
  const register = (toolName, description, parameters, execute) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(toolName)) throw new Error(`工具名不合规（网关会拒收整轮对话）：${toolName}`);
    ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));
  };

  register(
    'image_find',
    '在允许的根目录（默认当前会话工作区）下按关键词、尺寸、宽高比检索图片文件，返回真实路径、格式、像素尺寸、宽高比、清晰度档位、字节数与修改时间。'
    + '老师要“找一张合适的配图”时用它：指定 aspectRatio（如 "16:9"）会优先返回比例最接近的图，并过滤掉偏差超过 8% 的；'
    + '也可以用 minWidth / minHeight / minLongEdge / minBytes / orientation 做筛选。只读，不修改文件，不跟随符号链接。',
    {
      query: { type: 'string', description: '可选：文件名关键词，支持 * 与 ? 通配符（如“细胞*.png”）；省略表示匹配全部图片。' },
      directory: { type: 'string', description: '可选：在哪个目录下搜索，默认允许根本身。相对路径相对第一个允许根解析。' },
      aspectRatio: { type: 'string', description: '可选：目标宽高比，如 "16:9"、"4:3"、"1:1" 或 "1.78"。给定时按比例接近程度排序并过滤偏差 >8% 的图。' },
      orientation: { type: 'string', enum: ['any', 'landscape', 'portrait', 'square'], description: '可选：方向筛选，默认 any。landscape=横向，portrait=纵向，square=正方形。' },
      minWidth: { type: 'integer', description: '可选：最小宽度（像素）。' },
      minHeight: { type: 'integer', description: '可选：最小高度（像素）。' },
      minLongEdge: { type: 'integer', description: '可选：最小长边（像素）。要“够高清”可传 1280 或 1920。' },
      minBytes: { type: 'integer', description: '可选：最小文件字节数，用于滤掉缩略图。' },
      sort: { type: 'string', enum: ['aspect', 'resolution', 'recent', 'name'], description: '可选排序：aspect=比例最接近，resolution=最清晰（默认），recent=最近修改，name=按名称。' },
      recursive: { type: 'boolean', description: '是否递归子目录，默认 true。' },
      maxDepth: { type: 'integer', description: '递归最大深度，默认 6，范围 0–32。' },
      limit: { type: 'integer', description: '最多返回条数，默认 30，范围 1–200。' },
    },
    (args, exec) => handlers.find(args, exec),
  );

  register(
    'image_edit',
    '对一张图片做真实像素编辑并输出为新文件（绝不覆盖原图）。支持 6 种操作，按 operations 数组的顺序依次执行：'
    + 'crop（裁剪，给 aspect 按锚点裁到指定比例，或给 x/y/width/height 按盒裁切）、'
    + 'resize（缩放，contain=等比缩放到不超过目标框，cover=精确尺寸并居中裁切，stretch=拉伸，也可只给 maxLongEdge）、'
    + 'rotate（旋转，90/180/270 精确重绘，其他角度按包围盒重绘）、'
    + 'rounded（圆角，半径自动收敛到短边一半）、'
    + 'watermark（文字水印，九宫格定位、透明度、字号、颜色、描边、可倾斜）、'
    + 'adjust（亮度/对比度/饱和度，各 -100–100，逐像素计算）。'
    + '格式可转 PNG/JPEG（默认沿用原格式，非 PNG/JPEG 输入默认输出 PNG）。输出目录内同名文件自动加序号，不覆盖任何已有文件。',
    {
      path: { type: 'string', required: true, description: '要编辑的图片路径（允许根之内），支持 PNG/JPEG/GIF/BMP/WebP/SVG。' },
      operations: {
        type: 'array',
        required: true,
        items: { type: 'json' },
        description: '1–20 步操作，按顺序执行。示例：[{op:"crop",aspect:"16:9",anchor:"center"},{op:"rounded",radius:24},{op:"watermark",text:"第二章 光的折射",position:"bottom-right",opacity:0.7}]。'
          + 'adjust 示例：[{op:"adjust",brightness:8,contrast:12,saturation:15}]。resize 示例：[{op:"resize",maxLongEdge:1600}] 或 [{op:"resize",width:800,height:600,fit:"cover"}]。'
          + 'watermark 的 position 取 top-left/top-center/top-right/center-left/center/center-right/bottom-left/bottom-center/bottom-right。',
      },
      format: { type: 'string', enum: ['png', 'jpeg'], description: '可选：输出格式，默认沿用原格式（非 PNG/JPEG 输入输出 PNG）。' },
      quality: { type: 'integer', description: '可选：JPEG 质量 1–100，默认 90。' },
      outputName: { type: 'string', description: '可选：输出文件名（不含扩展名），默认“原名-edited”。' },
      outputDirectory: { type: 'string', description: '可选：输出目录（允许根之内）。默认写到会话工作区下的 Mochi Visuals/，没有受管工作区时写系统临时目录下的 mochi-visuals/。' },
    },
    (args, exec) => handlers.edit(args, exec),
  );

  register(
    'diagram_draw',
    '按结构化描述画出教学用图表，输出 SVG（矢量，可放进 PPT 继续放大编辑）与 PNG（位图，可放进 Word）。'
    + `支持 5 种 type：${DIAGRAM_TYPES.join(' / ')}——`
    + 'bar 柱状图、line 折线图（有坐标轴、刻度标签、网格线、数据标签、多序列图例）、'
    + 'pie 饼图（带百分比标签、引导线、图例）、'
    + 'flowchart 流程图（nodes + edges，自动分层布局、箭头、边标签，支持 start/end/decision/round 形状与 vertical/horizontal 方向）、'
    + 'relationship 关系图（放射布局，可指定 center 中心概念、group 分组着色、directed 有向箭头）。'
    + '配色为 Mochi 教学色（主色 #3F5B99、正文深灰 #2c2c2c），克制不花哨。数据有负数、合计为 0、节点 id 不存在等非法输入会直接报错，不会画出错误图表。',
    {
      type: { type: 'string', required: true, enum: DIAGRAM_TYPES, description: '图表类型：bar / line / pie / flowchart / relationship。' },
      title: { type: 'string', required: true, description: '图表标题（会画进图里，也是 SVG 的 aria-label）。' },
      subtitle: { type: 'string', description: '可选副标题。' },
      data: {
        type: 'json',
        description: 'bar/line 的数据，三种写法任选其一：[{label:"水的沸腾",value:100}]；带分组 [{label:"甲",value:12,series:"实验组"},{label:"甲",value:9,series:"对照组"}]；'
          + '对象形态 {labels:["甲","乙"],series:[{name:"实验组",data:[12,9]}]}。饼图用 [{label:"光合作用",value:45}]。有负数、空数组、饼图负数或合计为 0 都会报错。',
      },
      unit: { type: 'string', description: '可选：数值单位后缀，如 "%"、"℃"、"人"。会画在刻度与数据标签上。' },
      seriesName: { type: 'string', description: '可选：单序列数据的序列名，默认“数值”。' },
      yMin: { type: 'number', description: '可选：强制 Y 轴下限（不写则自动取整到好看的刻度）。' },
      yMax: { type: 'number', description: '可选：强制 Y 轴上限。' },
      nodes: {
        type: 'array',
        items: { type: 'json' },
        description: 'flowchart / relationship 的节点：[{id:"a",label:"提出问题",shape:"start"}]。shape 取 rect（默认）/ round / decision / start / end；relationship 还可加 group 分组、color 指定颜色。',
      },
      edges: {
        type: 'array',
        items: { type: 'json' },
        description: 'flowchart / relationship 的连线：[{from:"a",to:"b",label:"是"}]。from/to 必须是已声明的节点 id，否则报错。',
      },
      direction: { type: 'string', enum: ['vertical', 'horizontal'], description: 'flowchart 的方向，默认 vertical（从上到下）。' },
      center: { type: 'string', description: 'relationship 的中心节点 id；不写则自动用连接最多的节点。' },
      directed: { type: 'boolean', description: 'relationship 是否画有向箭头，默认 false（无向关系线）。' },
      showValues: { type: 'boolean', description: '是否画数据标签，默认 true。' },
      showLegend: { type: 'boolean', description: '是否画多序列图例，默认 true。' },
      colors: { type: 'array', items: { type: 'string' }, description: '可选：自定义配色数组（十六进制），按序列/扇区/分组顺序取用。' },
      width: { type: 'integer', description: '可选画布宽度，默认 760（流程图/关系图过小或过大时会自动扩展到不裁切）。' },
      height: { type: 'integer', description: '可选画布高度，默认 460（饼图 440、流程图 560、关系图 620）。' },
      pngScale: { type: 'integer', description: '可选 PNG 放大倍数 1–4，默认 2（越大越清晰、文件越大）。SVG 不受影响。' },
      formats: { type: 'array', items: { type: 'string' }, description: '可选：要输出哪些格式，默认 ["svg","png"]。可只传 ["svg"] 或 ["png"]。' },
      outputName: { type: 'string', description: '可选：输出文件名（不含扩展名），默认“<类型>-图”。同名自动加序号。' },
      outputDirectory: { type: 'string', description: '可选：输出目录（允许根之内）。默认写到会话工作区下的 Mochi Visuals/。' },
    },
    (args, exec) => handlers.draw(args, exec),
  );

  register(
    'teaching_image_match',
    '给定知识点或章节标题，在本机已导入的教材索引（DSH_HOME/knowledge/textbook.sqlite，由 mochi-knowledge 导入）里找对应的教材页与插图，'
    + '返回真实的 教材ID / PDF页号 / 印刷页号 / 识别状态 / 命中摘录，并给出用 mochi_knowledge_page_image 取原页 PNG 的方式。'
    + '本地教材库没有匹配时，明确返回“本地无匹配”，绝不伪造“已找到教材原图”；可附带一段联网检索建议（明确标注未执行任何联网请求）。'
    + '本工具只读索引、不做 OCR、不联网、不写任何数据。',
    {
      topic: { type: 'string', required: true, description: '知识点或章节标题，如“光的折射”“第2章 牛顿第一定律”。至少两个非空白字符。' },
      subject: { type: 'string', description: '可选：学科过滤，如“物理”（需与教材索引里的学科完全一致）。' },
      volume: { type: 'string', description: '可选：册别过滤，如“物理选择性必修 第二册”。' },
      bookId: { type: 'string', description: '可选：限定某一本教材（mochi_knowledge_search 返回的教材ID）。' },
      limit: { type: 'integer', description: '最多返回几条命中页，默认 5，范围 1–8。' },
      allowNetworkSuggestion: { type: 'boolean', description: '本地无匹配时是否附带联网检索建议（仅文字建议，不会真的联网），默认 true。' },
    },
    (args, exec) => handlers.match(args, exec),
  );

  ctx.logger?.info?.('[Mochi] 视觉工具族已注册：image_find/image_edit/diagram_draw/teaching_image_match（产物写入受管输出目录，绝不覆盖原图）。');
}

export { output };
export { IMAGE_EXTENSIONS };
