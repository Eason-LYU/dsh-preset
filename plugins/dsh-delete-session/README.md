# dsh-delete-session

给 DSH 会话右键菜单（`⋯` → 置顶/重命名/分叉/归档/复制 Session ID）再加一行 **删除会话**。
归档只是隐藏，删除是真的删。

![菜单位置](#) 菜单顺序：置顶 100 → 重命名 200 → 分叉 300 → 归档 400 → 复制 Session ID 450 → **删除会话 500**

## 它做了什么

一次「删除会话」＝

1. 从 `workspace.json` 的工作区记录里摘掉这个 sessionId（走注册表自己的写入路径，侧栏当场消失）；
2. 同时把它从 `archivedSessionIds` / `pinnedSessionIds` 里摘掉；
3. 删掉磁盘上 `%USERPROFILE%\.dsh\sessions\<工作区>\<sessionId>\` 整个目录；
4. 删掉它的投影缓存行 `storages\session_projcache\sessions\<sessionId>.json`（**0.2.0 新增**）——
   日志都没了，缓存里那份标题、首条提问全文、花费快照不该继续留在盘上。删前同样先备份。

不会动其他会话，也不会动工作区目录里的文件。

## 残留清理：`/gc`

历史删除（0.2.0 之前）只删了会话目录，留下了两类派生物：**孤儿缓存行**和**指向已删会话的归档 id**。
`/gc` 负责回收它们。

判定一条记录是「死」的，要同时满足：

- 不在 `sessions` 服务的内存里（活着的会话一律放过）；
- 不在 `sessionPersistence` 的索引里（**这是权威判据**：换了非目录存储后端时，「磁盘上没有目录」并不等于已删除）；
- 并且文件 mtime 早于 **24 小时**（刚建的会话可能在首次检查点之后才落目录，不能被当成残留）。

安全默认：

- **不做 dry run 就不删**——`POST /gc` 不带 `apply: true` 只报告；
- 删之前把每条记录复制到 `%USERPROFILE%\.dsh\backups\delete-session-gc\<时间戳>\`，并写 `manifest.json`；
- 重复执行是幂等的（第二次扫不到东西）。

```powershell
# 1) 看清单（只读）
curl.exe -X POST -H "x-dsh-delete-session: 1" -H "content-type: application/json" `
  -d '{}' http://127.0.0.1:4528/api/dsh-delete-session/gc

# 2) 真清
curl.exe -X POST -H "x-dsh-delete-session: 1" -H "content-type: application/json" `
  -d '{"apply":true}' http://127.0.0.1:4528/api/dsh-delete-session/gc
```

`minAgeMs` 可覆盖年龄下限（例如 `{"apply":true,"minAgeMs":0}` 清今天刚删的）。

## 离线工具

不开 DSH 也能看清单，用的是同一份判定代码（这里的「会话是否存在」只能靠目录判断）：

```powershell
node tools/gc-report.mjs            # 只读预览真实 ~/.dsh
node tools/gc-report.mjs --apply    # 备份后删除（沙盒里会 EPERM，需要全权限）
```

离线运行时备份写到插件目录下的 `.gc-backups\`，因为受限 shell 写不了 `~/.dsh`。
离线跑**不会**清理失效归档 id——那需要运行中的注册表，只能走 `/gc` 路由。

## 安全边界

- **接口不再裸奔**（2026-10-24 加固）：`/delete`、`/gc`、`/probe` 都要求自定义请求头 `x-dsh-delete-session: 1`——跨源网页加不了这个头（预检无人应答，请求直接死）；同时校验 `Origin` 必须与 `Host` 同源、`Sec-Fetch-Site` 不能是跨站。无头请求一律 403。
- **不删你正在看的会话**：页面会告诉 Host「这是我当前打开的」，Host 直接拒（`session-current`）。
- **驻留内存的会话要二次确认**：只要 sessions 服务还持有该会话（不管是不是当前页），第一次请求会被 `session-live` 拒绝，客户端弹出第二个确认框后才带 `allowLive` 重发。不再只信客户端上报的 `current`。
- 删除前要过一次 `confirm`：`该会话的全部记录会被永久删除，无法恢复`。
- 只接受 `POST`，只接受 `session-…` 形状的 id；无效请求返回 400/405。
- 别的会话删不掉也不会连累它：单个目录删除失败会返回 `partial` 并列出失败原因。

## 组成

| 文件 | 作用 |
|---|---|
| `lib/index.js` | Host 半：`/delete`、`/gc`、`/probe` 三条 HTTP 路由 |
| `lib/client.js` | 浏览器半：手写在 `window.__ModuleLoader__` 工厂形式里，往 `sidebar.workspaces.session.menu.item` 注册一行 |
| `cordis.patch.yml` | bundle 补丁：insert 一行 `dsh-delete-session` |
| `tools/test-host.mjs` | Host 半离线测试（假 DSH_HOME + 假注册表 + 假持久化索引） |
| `tools/test-client.mjs` | 客户端半离线测试（假 module-loader + 假 React + 假 fetch） |
| `tools/gc-report.mjs` | 离线残留清单 / 清理 |

没有构建步骤：`lib/client.js` 就是最终产物。

## 安装（本机已经装好）

```powershell
# 1. 以 link 形式装进 desktop profile（profile 里会自动加入 dsh.profile.bundles）
dsh plugin --profile desktop add E:\dsworkplace\dsh-delete-session

# 2. 让 loader 知道这一行（profile 的 cordis.patch.yml 末尾）
#    备份：cordis.patch.yml.bak-pre-delete-session-<时间戳>
- id: delete-session
  name: dsh-delete-session
```

装完 Host 半当场生效（路由可访问）；浏览器半需要刷新一次页面（F5）才会出现菜单项。
**改了 `lib/index.js` 之后 Host 半要重启 DSH 才换代码**（HMR 只盯 profile manifest 和 patch，不盯插件源码）。

## 验证

```powershell
# Host 半活着吗（注意：必须带自定义头，否则 403；端口以当前 GUI 为准）
curl.exe -H "x-dsh-delete-session: 1" http://127.0.0.1:4528/api/dsh-delete-session/probe

# 离线双向测试（含鉴权、驻留会话二次确认、gc 的年龄保护与备份用例）
node tools/test-host.mjs
node tools/test-client.mjs
```

`/probe` 返回当前工作区、每个工作区的会话数、归档数、Host 内存里活着的会话 id、缓存统计
（`cache.rows` / `cache.orphanRows` / `cache.orphanBytes`），以及依赖服务是否可见。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-delete-session
```

再从 profile 的 `cordis.patch.yml` 里删掉上面那段 `- id: delete-session`（或还原备份）。

## 已知限制

- **不碰别人的账本**：`cost-meter` 的费用台账仍按 sessionId 留历史行。那是它自己的存储域
  （单文件 11MB，有自己的写入链与锁），跨插件去改会把它写坏。要用费用统计就直接查它。
- **不碰附件**：`attachments/v1/objects` 是内容寻址、没有 session 维度，回收需要读遍所有活会话日志建引用集，
  风险高于收益，未实现。这部分空间（本机约 132MB）属于「设计如此」，不是删除漏了。
- **失效归档 id 只能走 `/gc` 路由**：它要调运行中注册表的 `unarchiveSession`，离线工具做不了。
- 侧栏是二进制打包的 `app.asar`，本插件不修改它；菜单项走的是公开 slot，DSH 升级后若 slot 名变了需要跟着改 `lib/client.js`。
- 「当前会话」的判定仍靠侧栏行的 selected 标记，属于启发式；兜底是 Host 的 `session-live` 二次确认。
- Host 内存里仍活着的旧会话可以删（需二次确认）；删完后目录不会回来，但那个会话对象会留在进程里直到重启，
  **若之后发生自动保存，记录可能被重新写回**——响应里的 `wasLive` 会标出这种情况。
- 缓存行是直接删文件的，不是走 `sessionProjectionCache` 的存储域。被判为「死」的会话不会再产生检查点，
  所以不会被写回；万一被写回（比如某个插件坚持 checkpoint），重跑 `/gc` 即可。

## 变更

- **0.2.0**（2026-11-03）：删除时一并清掉投影缓存行；新增 `/gc` 与 `tools/gc-report.mjs`；
  `/probe` 增加缓存统计。判据加了三重：不在内存、不在持久化索引、mtime 超过 24 小时。
- 0.1.0：删除会话（目录 + 工作区记录 + 归档/置顶）。
