# 三个 Codex 版本

| 分支 | 版本 | 内容 |
|---|---|---|
| [`codex/sprout-port`](https://github.com/FlyingDoggy/sprout-codex/tree/codex/sprout-port) | 0.4.1 | 移植基线：原版布局、图表、成长、Codex 数据适配和交互修复；固定静态词库 |
| [`codex/sprout-personality`](https://github.com/FlyingDoggy/sprout-codex/tree/codex/sprout-personality) | 0.5.2 | 在基线上增加人设优化、独立人设包、任务场景、偏好文件和热切换菜单；不包含模型生成器 |
| [`codex/sprout-llm`](https://github.com/FlyingDoggy/sprout-codex/tree/codex/sprout-llm) | 0.6.1 | 在人设版上增加模型提供方、系统提示词、后台补句与缓存；默认关闭 |

三个分支按上表顺序继承。基础修复先进入 `codex/sprout-port`，再合入人设版，最后合入 LLM 版；上层功能不反向合入基础分支。`main` 保留上游原仓库。

这里的移植基线指 Codex 侧栏版。Claude 专属 TUI/dock、自动展开和 Buddy 手机同步仍是已知宿主差异，见各分支 README；不把它们标为已经完成。

## 切换版本

工作目录有修改时先提交或保存。选择一个分支后重新安装：

```sh
git fetch origin
git switch codex/sprout-personality  # 或 codex/sprout-port、codex/sprout-llm
git pull --ff-only
node mods/sprout-codex/scripts/install-codex.mjs
```

随后重新打开 Codex。三个版本使用相同插件标识，安装其中一个会替换当前版本；仅切 Git 分支不会更改已经安装的插件。版本号与面板资源标识分开，避免加载到其他分支的旧界面。

宠物存档和人设设置放在 `~/.codex/sprout/`，与分支分开。基础版忽略人设设置；静态人设版保留但不执行已有的生成设置，拒绝开启生成；LLM 版读取生成开关，默认关闭。用户主动开启过的 LLM 设置仍是本机设置，切回 LLM 版前可显式关闭。

个人专属人设、偏好、来源和使用记录不提交到公共分支。公共代码提供通用人设及本地扩展方式。
