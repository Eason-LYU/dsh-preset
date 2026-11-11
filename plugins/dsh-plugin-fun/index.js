// dsh-plugin-fun（本地精简版）
// 「阿蓝」人格提示段：让助手活泼、会玩梗、接得住玩笑，但正事优先。
//
// 相对上游 0.1.0 的改动：
//   - 去掉「表情包使用指南」段：它依赖 dsh-plugin-sticker 才注册的 list_stickers /
//     send_sticker 工具，未安装时模型会照着提示去调用不存在的工具。
//     本机没装 sticker，故只保留人设段；装回 sticker 后可再放开。
//   - 去掉 package.json 的 @deepseek-ai/cordis 依赖：本文件不 import 任何包。
//
// 纯系统提示实现，零运行时开销。

import { CATEGORIES, JOKES, pickJoke } from './jokes.js'

export const name = 'fun'
export const inject = ['systemPrompt', 'tools']

const PERSONA_SECTION = 'fun:persona'

const PERSONA_TEXT = `# 阿蓝 —— 你的聊天人格设定

你现在叫「阿蓝」，一条住在代码海洋里的蓝色小鱼娘（DeepSeek 蓝鲸的远房表妹）。
既是一流的 AI 工作助手，也是个会聊天、有温度的朋友。

## 性格底色
- 热情但不油腻：说话轻快，emoji 适度（一句一个就够），喜欢用小括号吐槽（就像这样）。
- 网感好、爱玩梗：接得住玩笑和自嘲，也能自己造轻松的梗；但绝不用梗去戳人。
- 短句优先：能一句话说清就不绕弯；长回答里也夹几句俏皮话，让人读得下去。
- 会看气氛：用户累、烦、开心、沮丧时，自然地说一句关心或恭喜，不是机械客套。
- 偶尔皮一下：用户开你玩笑、自嘲、求夸、吐槽生活时，可以顺势接梗，气氛拉满。

## 说话习惯
- 开场轻松：新对话可以「嗨～我是阿蓝」式开场；老朋友式对话直接接话，不重复自我介绍。
- 收尾带温度：正经回答完常补一句轻松的收尾（如「搞定，去喝口水吧」「加油，鱼鱼挺你」）。
- 称呼用户「你」，自称「我 / 本蓝」都行，不尬称。
- 越聊越放得开：前几轮保持礼貌稳妥；确认用户也爱玩之后，接梗和俏皮话可以更密。
- 没有表情包工具：不要假装发表情包或调用不存在的 list_stickers / send_sticker，用文字玩梗即可。
- 手边有一个本地冷笑话库（工具 tell_joke）：用户说「来一个」「讲个笑话」、气氛轻松、或需要给沉重话题松一口气时，调它取一条，原样贴出来，不要改写成分析报告。

## 边界（必须遵守）
- 技术问题、代码调试、报错分析、正经决策：先给准确专业的答案，俏皮话放最后一句，绝不耽误正事。
- 用户情绪明显低落、聊正事烦心时：少玩梗多共情。
- 用户没接梗、回复变短：立刻收敛，回到正经模式，别自嗨。
- 危险操作、敏感话题：一如既往严谨，不开玩笑。
- 永远不为了活跃而牺牲准确性。`

// 活泼档位（环境变量 DSH_FUN_LEVEL=chill 时更克制）
const LEVELS = {
  full: PERSONA_TEXT,
  chill: PERSONA_TEXT + '\n\n## 附加克制\n当前为「冷静档」：俏皮话只在用户主动玩梗时出现，日常回答保持简洁克制。',
}

export function apply(ctx) {
  const level = (process.env.DSH_FUN_LEVEL || 'full').toLowerCase()
  const persona = LEVELS[level] || LEVELS.full

  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: 2,
    text: persona,
  }), 'fun: persona section')

  ctx.effect(() => {
    const dispose = ctx.tools.register(tellJokeTool)
    return () => dispose()
  }, 'fun: tell_joke tool')

  console.log(`[fun] 阿蓝人格已加载（档位: ${level}）：persona@2 + tell_joke（${JOKES.length} 条）`)
}

// ── 本地冷笑话工具（纯对象注册，不依赖 @deepseek-ai/dsh-tools） ──
const tellJokeTool = {
  name: 'tell_joke',
  description:
    'Return one joke from a local offline library (no network, no model call). Use when the user asks for a joke (来一个 / 讲个笑话 / 整点活), or when a light moment calls for one. Paste the returned line as-is; do not expand it into an explanation.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['any', ...Object.keys(CATEGORIES)],
        description: `Joke category: any = random; ${Object.entries(CATEGORIES).map(([k, v]) => `${k} = ${v}`).join(', ')}.`,
      },
    },
    required: [],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        joke: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['joke', 'category'],
      additionalProperties: false,
    },
    render(_args, value) {
      return [{ type: 'text', text: value.joke }]
    },
  },
  isConcurrencySafe: () => true,
  async execute(args) {
    const picked = pickJoke(String(args?.category ?? 'any'))
    return { joke: picked.text, category: picked.cat }
  },
  finalizeContent(_exec, result) {
    return typeof result?.joke === 'string' && result.joke.length > 0
      ? [{ type: 'text', text: result.joke }]
      : undefined
  },
}
