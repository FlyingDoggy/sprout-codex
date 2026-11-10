# 把小苗装进 Codex

小苗住在 Codex 的侧栏里：看用量和额度，喂水、摸摸，再让它嘴一句。

本教程适用于 macOS。安装完成后由 Codex 启动插件，不需要另开终端运行服务。

## 让 Codex 帮你装

把下面这段话复制给 Mac 上的 Codex：

```text
帮我安装小苗 Codex 版：从 https://github.com/FlyingDoggy/sprout-codex.git 克隆 codex/sprout-port 分支到 ~/Projects/sprout-codex。先检查 Node.js 22+、Git，以及支持 plugin 命令的 Codex CLI。已有仓库就检查来源和本地修改，再用 git pull --ff-only 更新。

在仓库根目录运行 node mods/sprout-codex/scripts/install-codex.mjs，检查 sprout-codex@muyu-sprout 已安装并启用。只使用这个安装器。完成后提醒我完全退出并重新打开 Codex，再说“打开小苗”。
```

## 自己动手装

### 1. 检查准备工作

先装好并登录 Codex 桌面客户端，再在「终端」运行：

```sh
node --version
git --version
codex --version
codex plugin --help
```

- Node.js 需要 **22 或更新版本**。未安装时，使用 [Node.js 官方安装包](https://nodejs.org/en/download)。
- Git 未安装时，按 macOS 的命令行工具安装提示完成安装。
- `codex` 或 `plugin` 命令不存在时，按 [Codex 官方 CLI 安装说明](https://developers.openai.com/codex/cli/)安装或更新。桌面客户端和 CLI 都需要准备好。

本教程已在 macOS、Codex CLI **0.143.0** 验证。桌面客户端需要支持本地插件和 MCP App 面板。

### 2. 下载并安装

```sh
mkdir -p "$HOME/Projects"
git clone --depth 1 --branch codex/sprout-port https://github.com/FlyingDoggy/sprout-codex.git "$HOME/Projects/sprout-codex"
cd "$HOME/Projects/sprout-codex"
node mods/sprout-codex/scripts/install-codex.mjs
```

看到 `Added plugin` 和 `小苗已安装` 即完成安装。发布包已经包含运行文件，不用运行 `npm install` 或构建命令。

目前 Codex 版在 **`codex/sprout-port` 分支**，上面的克隆命令已经指定。若目标目录已经存在，先确认它是这个仓库，再按下方「更新」操作。

### 3. 打开小苗

1. 完全退出 Codex，再重新打开。
2. 在对话中说：**打开小苗**。
3. 如果只出现了对话里的小苗卡片，点击卡片的展开图标，打开右侧面板。

看到「喂水」「摸摸」「再嘴一句」三个按钮，就可以用了。第一次读取历史记录可能需要稍等一会儿。

## 按需开启

### 订阅额度

在终端检查 Codex CLI 的登录状态：

```sh
codex login status
```

未登录时运行 `codex login`，登录你的订阅账号，然后在 Codex 里说「刷新小苗」。

### GitHub 贡献

装好 [GitHub CLI](https://cli.github.com/) 后，在终端运行：

```sh
gh auth login --hostname github.com
```

完成后重新加载小苗插件或重开 Codex，让它重新读取 GitHub。没有 GitHub 登录也能养小苗、看 Codex 用量。

## 更新

回到当初克隆的目录：

```sh
cd "$HOME/Projects/sprout-codex"
git pull --ff-only
node mods/sprout-codex/scripts/install-codex.mjs
```

然后完全退出并重新打开 Codex，再说「打开小苗」。**面板内的刷新只更新数据，不会换成新版界面。** 更新会保留已有的宠物状态。

如果 `git pull` 提示本地修改或分支分叉，先处理这些修改，再更新。

## 常见问题

| 遇到的情况 | 怎么处理 |
|---|---|
| 装好后仍找不到小苗 | 重开 Codex，在插件列表中查找「Muyu · 小苗」来源下的「小苗 · Codex」，确认已启用。终端也可运行 `codex plugin list` 检查。 |
| 只在对话中出现卡片 | 点击卡片展开图标。侧栏不会在所有客户端版本中自动展开。 |
| 更新后还是旧界面 | 完全退出并重开 Codex，再打开小苗；面板刷新按钮不会重新加载插件代码。 |
| 暂无额度 | 检查 `codex login status`，确认 CLI 已登录订阅账号，再让 Codex 刷新小苗。 |
| 没有 GitHub 图表 | 检查 `gh auth status --hostname github.com`，登录后重新加载插件。 |
| 还没有 Token 记录 | 完成一次本机 Codex 对话后刷新。小苗读取本机的会话和归档记录。 |
| Node 升级后小苗连不上 | 重新运行安装器，再重开 Codex；安装器会更新 Node 的启动路径。 |
| 想像 Buddy 一样在手机上看 | 当前 Codex 版还没有手机同步。 |

## 卸载

```sh
codex plugin remove sprout-codex@muyu-sprout
```

重开 Codex 后生效。宠物状态和统计缓存会保留在 `~/.codex/sprout/`，重新安装可以继续使用。

更多功能和配置见 [README](README.md)。教程结构参考 [Buddy 的安装页面](https://buddy.qingqi.dev/zh)；原版小苗来自 [QingqiShi/claude](https://github.com/QingqiShi/claude/tree/main/mods/sprout)。
