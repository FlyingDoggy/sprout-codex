---
name: sprout
description: 打开小苗，查看 Codex 本机用量、订阅额度与 GitHub 贡献，或给像素宠物喂水、摸摸。
---

Call the Sprout MCP server's `sprout_status` tool to open the dashboard. Set `refresh: true` when the user asks for an update. Hosts that support MCP Apps show the interactive panel; otherwise summarize the tool result.

Use `sprout_interact` with `action: feed` or `action: pat` for the requested pet interaction.

Usage covers retained local Codex sessions, including archived sessions. All history automatically contributes to growth, independently of the dashboard's date filter. It is not the whole ChatGPT account's usage. Cached reads and writes are included in input, and reasoning tokens are included in output; do not add them again. Prices come from OpenAI's official pricing page and are cached for offline use. Report the verification date and assumptions when explaining costs: these are current-price API-equivalent estimates, not past payments or subscription bills. Unknown models remain unpriced; partial known totals show coverage.

Read quota source and timestamps. Session-derived readings can be stale; forecasts are estimates. Missing quota data does not mean the account has no remaining quota.

The installed plugin runs through Codex-managed stdio. Do not start the standalone HTTP server to open the native panel. Use `sprout_status` so the host loads the MCP App resource. For setup or a host without UI support, see the plugin's `README.md`; standalone HTTP is a development preview only.
