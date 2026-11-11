# dsh-plugin-fun 🐟✨

DeepSeek Harness「阿蓝」人格插件 —— 让 AI 从"冷淡工具人"变成"有性格、会玩梗、主动发表情包"的聊天搭子。

> 配套插件：[dsh-plugin-sticker](https://github.com/keeshakulbida948-tech/dsh-plugin-sticker)（表情包图库）。
> 装了 sticker 才发得出图；只装 fun 的话 AI 会变得活泼，但没图可发（自动降级为纯文字玩梗）。

## 它做什么

纯系统提示实现，零运行时开销：

| 段 | order | 内容 |
| --- | --- | --- |
| `fun:persona` | 2 | 「阿蓝」人格：热情不油腻、爱玩梗、短句优先、会关心人；聊得越熟越放得开 |
| `fun:sticker-guide` | 30 | 表情包使用铁律：**什么时候必须主动发**（情绪/干饭/求夸/救场）、怎么选图、纪律（每轮≤1张、严肃话题不发） |

**核心设计**：
- 🎭 **性格化**：AI 有名字（阿蓝）、有说话习惯（emoji/小括号吐槽/带温度的收尾）
- 🔥 **主动激活表情包**：把"用户开心/难过/吐槽/聊吃饭 → 主动 send_sticker"写成明确习惯，而不是等用户开口要
- 📈 **熟悉度递进**：开场礼貌克制，聊过几轮确认用户爱玩后自动放开——用得越久越能碰到它的另一面
- ⚖️ **边界清晰**：技术问题先给准话、严肃场景不发图、用户叫停立刻收敛

## 安装

```bash
# 直接安装（GitHub）
dsh plugin --profile web add https://github.com/keeshakulbida948-tech/dsh-plugin-fun

# 或本地目录安装（开发调试）
dsh plugin --profile web add /path/to/dsh-plugin-fun

# 装完重启 dsh web 生效
dsh web
```

验证已挂载：

```bash
dsh --profile web --dump-config | grep fun
```

## 配置

| 项 | 说明 |
| --- | --- |
| 环境变量 `DSH_FUN_LEVEL` | 活泼档位：`full`（默认，全面放开）/ `chill`（冷静档，只在用户明示或情绪极强时发图） |

## 与人设/预设的关系

dsh 官方有 `deployment:persona` 槽（agent preset 会覆盖它）。本插件**不动官方槽**，
注册独立的 `fun:persona` / `fun:sticker-guide` 段，与官方人设并存，装/卸互不干扰。

## 卸载

```bash
dsh plugin --profile web remove dsh-plugin-fun   # 之后重启 dsh
```

## License

MIT
