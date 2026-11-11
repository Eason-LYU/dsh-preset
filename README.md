# dsh-preset — 一套 DeepSeek Harness 插件预设

把本仓库克隆下来跑一个脚本，就能得到和作者差不多的 DSH 效果（16 个第三方插件，其中 2 个是本仓库自带的本地插件）。

## 先决条件

- 已安装 **DeepSeek Harness** 桌面版（Windows）。
- 能联网（会从 npm 拉插件）。
- 建议先用一个空闲的 profile 试，避免覆盖你已有的配置。

## 三步装好

```powershell
git clone <本仓库地址> dsh-preset
cd dsh-preset
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 找到 `dsh` CLI；
2. 按 `preset.json` 逐个 `dsh plugin --profile desktop add <spec>`；
3. 把包名补进 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`（不补不会加载）；
4. 提示你重启 DSH。

先看要装什么、不动手：`.\install.ps1 -DryRun`

装到别的 profile：`.\install.ps1 -ProfileName web`

## 装了什么

| # | 插件 | 版本 | 作用 | 上游仓库 |
|---|---|---|---|---|
| 1 | `@a9i5k4/dsh-auto-memory` | 3.3.17 | 自动记忆：日志/笔记/反思/白板，跨会话唤回 | https://github.com/Aik358/dsh-auto-memory |
| 2 | `@idoall/dsh-notify` | 0.4.6 | 任务完成页内通知 | https://github.com/idoall/dsh-notify |
| 3 | `@liustack/modlens` | 3.27.1 | 给纯文本模型加视觉（读图/截图 OCR） | https://github.com/liustack/modlens |
| 4 | `@liustack/modsearch` | 5.10.7 | 免费网页搜索、读页、x_search | https://github.com/liustack/modsearch |
| 5 | `@vectorize-io/hindsight-coding-agents` | 0.8.1 | Hindsight 长期记忆知识页 | https://github.com/vectorize-io/hindsight |
| 6 | `@wxg-prc-cpg/browser-skill-dsh-plugin` | 0.3.3 | 操作本机登录态 Chromium（bsk_* 工具） | https://github.com/Tencent/BrowserSkill |
| 7 | `dsh-cost-meter` | 1.8.35 | 会话/当日费用统计与余额 | https://github.com/Han-1413141/dsh-cost-meter |
| 8 | `dsh-diff-approval` | 0.35.0 | 改动审阅面板与行内批注 | https://github.com/9087/dsh-diff-approval |
| 9 | `dsh-free-search` | 0.9.1 | 多引擎免费搜索 | https://github.com/DDDMUC/dsh-free-search |
| 10 | `dshmarket` | 1.66.32 | 插件市场 | https://github.com/dsh-market/dsh-market |
| 11 | `dsh-click` | 0.3.24 | 桌面级点击/输入/截图 | https://github.com/PerryLink/dsh-click |
| 12 | `dsh-whale-widget` | 0.4.2 | 右下角余额小鲸鱼挂件 | https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget |
| 13 | `dsh-nekowhale-stickers` | 1.1.1 | 大肥鱼表情库（322 张） | https://github.com/Loping151/dsh-nekowhale-stickers |
| 14 | `dsh-plugin-fun` | 0.2.0 | 「阿蓝」人格 + 离线冷笑话库 | 本仓库 `plugins/dsh-plugin-fun` |
| 15 | `dsh-delete-session` | 0.2.0 | 会话右键「删除会话」+ 清残留元数据 | 本仓库 `plugins/dsh-delete-session` |

> `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 是 DSH 自带的两个 bundle，不用装也不用写进本表。

## 不包含什么

- **记忆内容**：`~/.dsh/memory/`、工作区 `.dsh-memory/` 属于个人数据，不放进预设。
- **技能库**：`~/.dsh/skills/` 与 procedure memory 是本地积累，按需自己攒。
- **账号与密钥**：`~/.dsh/.credentials.yaml`、模型配置、`settings` 里的私人项全部不含。
- **工作区文件**：`E:\dsworkplace` 之类的内容与插件无关。

## 想改

- 只想装一部分：编辑 `preset.json`，删掉不要的条目再跑脚本。
- 想锁版本：`version`/`spec` 已经是精确版本，升级时手动改。
- 想换成本地开发：把 `spec` 写成 `./你改的目录` 即可（脚本会转成 `file:` 绝对路径）。

## 许可

`plugins/` 下两个本地插件为 MIT。其余插件按其上游许可证分发，本仓库只做安装清单，不复制它们的代码。
