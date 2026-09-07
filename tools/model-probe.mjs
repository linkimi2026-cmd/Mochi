#!/usr/bin/env node
/**
 * Mochi 模型工具调用能力压测。
 *
 * 为什么单独做这个：换模型不能靠"感觉更强"。Mochi 的全部价值建立在
 * 「模型自主选工具」上，选错工具或干脆不调用 = 幻觉，直接判死刑。
 * 这里用同一个校园查询场景，逐个模型跑 N 次，统计：
 *   - callRate   : 触发工具调用的比例（不调用 = 必然幻觉）
 *   - correctRate: 调用了 campus_query_student 的比例
 *
 * 用法：node tools/model-probe.mjs [模型名 ...]
 */

const KEY = process.env.ZHIPU_API_KEY
if (!KEY) { console.error('需要 ZHIPU_API_KEY 环境变量'); process.exit(1) }

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 3)

// 与 plugins/mochi-campus 里注册的真实工具同构
const TOOLS = [{
  type: 'function',
  function: {
    name: 'campus_query_student',
    description: '查询学生当前流转状态。当用户询问某个学生在哪儿、是否返班、是否超时、或要列出当前在医务室/外出未归的学生时调用。支持按姓名或班级查询；不带关键词时返回全部在途学生。',
    parameters: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '学生姓名或班级名。留空则返回全部在途学生。' } },
      additionalProperties: false,
    },
  },
}]

const CASES = [
  '现在哪些学生在医务室？',
  '张明远现在在哪儿？',
  '有没有学生外出超时没回来的？',
]

async function ask(model, userText) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是 Mochi，校园 AI 助手。你只能通过工具获取校园实时状态，绝对不能凭空编造学生信息或状态。' },
        { role: 'user', content: userText },
      ],
      tools: TOOLS,
      stream: false,
    }),
  })
  const json = await response.json()
  if (json.error) return { error: `${json.error.code} ${json.error.message}` }
  const message = json.choices?.[0]?.message ?? {}
  const calls = message.tool_calls ?? []
  return {
    called: calls.length > 0,
    names: calls.map((c) => c.function?.name),
    text: (message.content ?? '').slice(0, 60),
  }
}

const models = process.argv.slice(2)
if (models.length === 0) { console.error('给至少一个模型名'); process.exit(1) }

console.log(`每个模型 ${CASES.length} 场景 × ${ROUNDS} 轮\n`)
for (const model of models) {
  let calls = 0, correct = 0, total = 0
  const errors = new Set()
  for (let round = 0; round < ROUNDS; round++) {
    for (const text of CASES) {
      total++
      const result = await ask(model, text)
      if (result.error) { errors.add(result.error); continue }
      if (result.called) calls++
      if (result.names.includes('campus_query_student')) correct++
    }
  }
  const pct = (n) => `${Math.round((n / total) * 100)}%`
  console.log(
    `${model.padEnd(18)} 工具调用率 ${pct(calls).padStart(4)}  正确工具率 ${pct(correct).padStart(4)}` +
    `${errors.size ? `  错误: ${[...errors].join(' | ')}` : ''}`
  )
}
