# 人设与台词

人设、个人偏好、任务识别、台词生成分开维护。原版页面、三个按钮、像素动作和成长算法保持原样。默认使用 `classic` 静态人设，本分支不包含模型生成器。

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

`scopes` 为空代表通用，或填写上面的任务分类。让 Codex 根据已确认的长期偏好整理单条 JSON，再运行 `node dist/cli.js personality remember /absolute/path/entry.json`。同一 `id` 替换旧条目，并保留一份 `preferences.previous.json` 可回退。也可以直接修改整个文件。修改后人设修订标识更新；来源字段只保存在本机。

这不是对 Codex 全局记忆服务的自动同步。只有明确整理进文件的偏好会被读取；一次性的客户要求不自动升级为长期性格。偏好文件供后续维护人设时参考；本分支不会自动编写台词。将偏好编入静态词库需要编辑人设包。

## 分支边界

这个分支只有静态人设，没有模型提供方、生成进程或生成缓存读取逻辑。已有配置文件里的生成设置会原样保留，切换人设不会改写它们，但本分支不会执行；`personality generation on` 会被拒绝。

模型补充在 `codex/sprout-llm` 分支，见 [版本说明](BRANCHES.md)。

## 本地试用与发布分开

可把个人包放在仓库忽略的 `work/` 内，并用 `SPROUT_DATA_DIR` 指向它做隔离测试。个人偏好、来源、生成缓存和验证记录不进入公共仓库。构建不会安装插件；只有再次运行安装器才会更新已安装版本。
