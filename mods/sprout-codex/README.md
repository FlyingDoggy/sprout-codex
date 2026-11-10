# 小苗 · Codex

Sprout 的 Codex 适配版。复用 [QingqiShi 的小苗](https://github.com/QingqiShi/claude/tree/main/mods/sprout)像素宠物和 SVG 图表，新增 Codex 用量采集、额度查询、本地网页和 MCP App 接入。

## 直接运行

需要 Node.js 22 或更新版本。仓库包含 `dist/`，运行时不需要安装 npm 依赖。

```sh
cd mods/sprout-codex
node dist/cli.js serve
```

打开 <http://127.0.0.1:4317>。`--port 4318` 可以更改端口。服务只监听本机回环地址；关闭终端或按 Ctrl+C 停止。

```sh
node dist/cli.js status       # 只输出汇总 JSON
node dist/cli.js serve --demo # 明确标记为演示数据，不连接真实账号
```

真实数据会扫描 `CODEX_HOME`（默认 `~/.codex`）下的 `sessions/` 和 `archived_sessions/`。第一次扫描耗时取决于日志大小，随后按文件增量读取。缓存和宠物状态默认写入 `~/.codex/sprout/`。

实时额度需要已登录的 `codex` CLI。GitHub 贡献与合并记录需要 `gh auth login --hostname github.com`。缺少任一项不会阻止本机 Token 统计和宠物交互。

## 在 Codex 中使用

### 方式一：本地插件目录

仓库根目录包含 `.agents/plugins/marketplace.json`，插件位于 `mods/sprout-codex/`。

在支持本地插件的 Codex 客户端中打开这个仓库，重启客户端，从 `Muyu · 小苗` 来源安装「小苗 · Codex」。安装后在新对话中说“打开小苗”，或者调用 `sprout` skill。

也可先在仓库根目录注册本地来源：

```sh
codex plugin marketplace add .
```

本地插件安装会复制到 Codex 的插件缓存。更新本仓库后，需要刷新或重新安装插件，才能使用新版本。

### 方式二：直接注册 MCP

在本目录中运行：

```sh
codex mcp add sprout -- node "$PWD/dist/cli.js" mcp
```

这会修改当前 Codex 用户的 MCP 配置。新会话中可以调用 `sprout_status`、`sprout_interact`。移除时运行 `codex mcp remove sprout`。两种方式任选其一，避免重复注册。

MCP Apps 兼容客户端可显示交互面板；已声明对话侧面板与全屏入口。具体宿主是否显示这些入口由客户端决定。CLI 等没有图形界面的宿主仍会得到文本和结构化数据。原版 Claude 的自动弹出、常驻侧栏不直接继承；本地网页提供同一套界面。

## 功能与统计口径

- 宠物、喂水、摸摸、持久化成长；保留原版等级阈值。
- 每日 Token、30 天/全部范围、趋势和使用热力图。
- 输入含缓存命中，输出含推理 Token，两者都不会重复相加。
- 基于累计用量的增量统计，忽略重复/落后快照；相同时间戳及累计计数的继承历史去重。
- 额度优先查询 `account/rateLimits/read`，失败时使用最近会话中的未过期读数并标明来源。按返回的窗口长度显示，不硬编码五小时或一周。
- 预测只对十分钟内的读数显示，是使用节奏估计，不代表服务端承诺。
- GitHub 过去一年贡献、最近 30 天合并 PR 和增删行数；每 30 分钟缓存更新。
- 只覆盖本机保留的 Codex JSONL 记录，不等于整个账号或其他设备的用量。删除日志后可统计范围会相应缩小，宠物最高等级保留。
- 日志扫描读取文件，但只保留用量、时间戳、模型与额度字段；不缓存或返回提示词、回复正文、仓库名称或 PR 标题。
- 额度查询通过 Codex 自己的登录状态发起，插件不读取或传输登录凭据。只查询账号额度，不发起模型调用。GitHub 查询通过本机 `gh` 发起。
- 本版没有启用原版 Buddy 手机同步，不向 Buddy 上传数据。

如果日志只保留了中途开始的累计快照，首个累计值会落到首个可见事件日期；无法从残缺日志重建更早的逐日分布。累计计数下降被视为过期快照；未来 Codex 格式发生变化时需要更新适配器。

## 可选配置

| 环境变量 | 用途 |
|---|---|
| `SPROUT_CODEX_HOME` | 覆盖 Codex 会话目录；也传给额度查询进程 |
| `SPROUT_DATA_DIR` | 覆盖缓存和宠物状态目录 |
| `SPROUT_CODEX_BIN` | 指定 Codex CLI 可执行文件 |
| `SPROUT_TIMEZONE` | IANA 时区，默认本机时区 |
| `SPROUT_LIVE_QUOTA=0` | 只使用日志里的额度读数 |
| `SPROUT_GITHUB=0` | 不查询 GitHub |
| `SPROUT_PORT` | 本地网页端口，默认 4317 |
| `SPROUT_PRICES_FILE` | 自己维护的模型单价 JSON 文件 |

价格按每百万 Token 的美元单价配置，以日志里的模型名精确匹配。格式为 `{ "模型名": { "input": 数字, "cached": 数字, "output": 数字 } }`。默认不内置价格，避免把未知模型记为零费用。配置后会按原始计数重算，页面仍标明 API 估算费用，不当作订阅账单。更新价格文件后重启服务。

## 开发和检查

```sh
npm ci
npm run check
npm run build
npm test
npm run test:codex # 可选：需要 Codex CLI，隔离安装并验证插件启动，不修改个人配置
```

提交源码时同步更新 `dist/cli.js` 与 `dist/ui.html`。两者已打包全部 JavaScript 依赖，供本地插件直接运行。

测试覆盖 Token 去重与计费口径、增量日志尾部、归档/截断/删除、额度过期、并发宠物状态、MCP stdio 与资源读取、本地 HTTP 来源检查。

MCP 配置使用相对 `cwd` 和入口路径，已在 Codex CLI 0.143.0 验证。该版本的兼容配置不会展开 Claude 的插件根目录变量，因此不依赖这类变量。

上游原版保留在 `../sprout/`。移植文件和来源见 [NOTICE.md](NOTICE.md)。本仓库其他 Claude 配置属于上游内容；运行 Codex 版不需要执行根目录的 `bootstrap.sh`。
