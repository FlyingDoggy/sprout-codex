# 人设与台词

当前为 `codex/sprout-llm`，在静态人设版上增加可选模型补充。仅需静态人设时使用 `codex/sprout-personality`；见 [三个版本](BRANCHES.md)。

人设、个人偏好、任务识别、台词生成分开维护。原版页面、三个按钮、像素动作和成长算法保持原样。默认使用 `classic` 静态人设，模型生成开关为 **关闭**。

## 人设包

内置 `classic`（当前小苗）与 `delivery`（方案、PPT、研究、报价、教学、代码和演示均适用的交付搭子）。切换只影响台词，不改变等级或用量。

```sh
node dist/cli.js personality show
node dist/cli.js personality use delivery
node dist/cli.js personality use classic
```

个人配置在 `SPROUT_DATA_DIR`（默认 `~/.codex/sprout/`），与插件安装目录分开。自定义包放到 `personas/<id>.json`：

```json
{
  "schemaVersion": 1,
  "id": "my-sprout",
  "version": "1",
  "extends": "delivery",
  "name": "我的小苗",
  "identity": "懂方案、懂交付，嘴臭又护短的像素植物。",
  "pools": { "happy": ["你负责端到端，我负责蹲到晚。", "老板，员工，售后，全挤一张椅子上。"] },
  "scenes": { "slides": ["改一页就改一页，谁让它拆整栋楼了？", "母版放那儿呢，这傻逼又开始自由发挥。"] }
}
```

然后运行 `node dist/cli.js personality use my-sprout`。可覆盖 `identity`、`voice`、`pools`、`scenes`、`signals`。格式定义和内置内容见 `src/core/personality.ts`、`src/server/personality-config.ts`。每个覆盖池至少两句，每句必须放得下原版三行气泡。

有效修改在下一次面板刷新时读取，无需重装。错误文件回退到原静态台词，不影响统计。切换人设不会开启模型生成。

点右上角项目名可以展开人设菜单，选择后立即热切换。菜单自动列出有效的本地人设，勾选当前项；同一个菜单也保留“刷新”。点外面或按 Esc 收起，方向键可以选择。没有项目名时显示一个省略号入口。

这是本机同一个数据目录共用的选择，各聊天继续使用自己的任务场景。其他打开的面板在下一次轮询读取更改，面板可见时每 15 秒读取一次。首次安装包含人设功能的新版时需要重新加载插件；宿主不能单独重载插件时再重启 Codex。此后只切人设、编辑台词或偏好无需重启。

已在同一个持续运行的 MCP 进程中验证 30 次来回切换、编辑当前包、错误文件回退和修复恢复；宠物存档、历史用量及额度不因切换改变。

喂水、摸摸、再嘴一句分别保存轮换位置，交替点击不会重新从同一句开始。连续三次喂水／摸摸保留撑伞／躲避反应，各有十二句嫌烦台词；点击“再嘴一句”立即离开互动台词，回到当前工作场景。工作事件短台词池会接入日常吐槽。任务和细分信号的台词与当前人设合并，不再把整个词库缩成两三句。

## 任务与个人偏好

本机日志的用户消息只在内存中分类，保存 `consulting / slides / commercial / research / teaching / coding / media / personal / general` 标签，以及范围变化、布局、措辞、证据、审阅等信号。聊天切换按当前 thread ID 隔离；不把某个文件夹永久认定为开发项目。该分类使用保守关键词，简短的“继续”沿用上一场景，不能理解每一句话的含义。

只保存标签，不保存用户消息、客户材料、命令或输出。没有聊天上下文的全局面板不猜当前工作类型。历史 Token 本来就包括非代码任务，成长计数不需要为这些场景加权或补记。

明确的长期偏好写到 `preferences.json`：

```json
{
  "schemaVersion": 1,
  "preferences": [
    {
      "id": "plain-language",
      "text": "中文说人话，不堆空话和自造简称。",
      "scopes": [],
      "source": "用户明确要求，或对应 skill/聊天标识",
      "updatedAt": "2026-11-10"
    }
  ]
}
```

`scopes` 为空代表通用，或填写上面的任务分类。让 Codex 根据已确认的长期偏好整理单条 JSON，再运行 `node dist/cli.js personality remember /absolute/path/entry.json`。同一 `id` 替换旧条目，并保留一份 `preferences.previous.json` 可回退。也可以直接修改整个文件。修改后缓存版本自动失效；来源字段留在本机，不进入台词生成请求。

这不是对 Codex 全局记忆服务的自动同步。只有明确整理进文件的偏好会被读取；一次性的客户要求不自动升级为长期性格。静态模式依靠人设文案体现偏好，偏好文件只有开启生成后才参与新句子的编写。将偏好编入静态词库需要编辑人设包。

## 可选 Codex 订阅生成

生成器调用已登录的官方 `codex exec`，使用 ChatGPT 订阅，无需 API key。需要支持所选模型的 CLI；终端安装的旧版可能与桌面内置版本不同。模型可用性以真实调用为准，不能仅凭缓存列表推断。

`personality.json` 示例：

```json
{
  "schemaVersion": 1,
  "persona": "delivery",
  "generation": {
    "enabled": false,
    "provider": "codex",
    "model": "gpt-6-luna",
    "minIntervalMs": 900000,
    "maxBatchesPerDay": 12,
    "timeoutMs": 45000
  }
}
```

可以填写 `generation.binary` 指定已验证的 Codex 可执行文件，未填写时沿用 `SPROUT_CODEX_BIN`。这是本机路径，不应写死进公共发布包。`generation.enabled` 是生成开关：

```sh
node dist/cli.js personality generation off
# 只有决定使用订阅生成时，再执行：
node dist/cli.js personality generation on
```

关闭时既不发起调用，也不显示之前生成的缓存台词。开启后，缺少当前场景缓存或缓存超过一天时，后台补充一批六句；最多每十五分钟一批、每天十二批。额度已满的近期读数会阻止生成。每次刷新和点击只读本地数据，不等待模型。超时、断网、不可用模型或不合格输出均回退；失败也计入当日尝试次数，避免反复消耗。

缓存按人设版本、偏好内容、模型、聊天和任务场景隔离，至少两句通过长度和格式检查才接纳。生成只收到人设、最多八条相关偏好、场景标签、当前事件和少量例句，不收到整个聊天、文件路径或客户材料。模型只返回台词，动作、成长和额度仍由确定性代码控制。

官方 CLI 使用临时会话、空工作目录和只读模式，禁用 Shell、插件、Apps、记忆、浏览器等工作工具；插件不读取登录凭据。临时文件结束后清理，不保留用于刷成长的生成会话。生成会占用现有 Codex 额度；实测一次单句调用包含启动约十秒，因此它是后台补充能力，不承诺点击即刻推理。

系统提示词在 `src/server/dialogue-provider.ts` 的 `DIALOGUE_SYSTEM_PROMPT`，可替换的提供方接口为 `DialogueProvider`。`dialogue-status.json` 记录最后一次生成状态与耗时，不在宠物页面增加说明。

## 本地试用与发布分开

可把个人包放在仓库忽略的 `work/` 内，并用 `SPROUT_DATA_DIR` 指向它做隔离测试。个人偏好、来源、生成缓存和验证记录不进入公共仓库。构建不会安装插件；只有再次运行安装器才会更新已安装版本。
