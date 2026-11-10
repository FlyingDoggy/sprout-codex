---
name: sprout
description: 打开小苗，查看 Codex 本机用量、订阅额度与 GitHub 贡献，或给像素宠物喂水、摸摸。
---

Call the Sprout MCP server's `sprout_status` tool to open the dashboard. Set `refresh: true` when the user asks for an update. Hosts that support MCP Apps show the interactive panel; otherwise summarize the tool result.

Use `sprout_interact` with `action: feed` or `action: pat` for the requested pet interaction.

Usage covers retained local Codex sessions, including archived sessions. It is not the whole ChatGPT account's usage. Cached tokens are included in input, and reasoning tokens are included in output; do not add them again. Unpriced costs are unknown, not zero. Estimates are separate from subscription bills.

Read quota source and timestamps. Session-derived readings can be stale; forecasts are estimates. Missing quota data does not mean the account has no remaining quota.

For local setup or a host without UI support, see the plugin's `README.md`. The standalone dashboard uses the same data and supports pet interactions.
