---
name: sprout
description: 打开小苗，查看 Codex 用量和额度，喂水、摸摸、再嘴一句，向 Tibo 求雨或叫 CatGPT 来串门。
---

Call the Sprout MCP server's `sprout_status` tool to open the dashboard. Pass the current chat's working directory as `cwd` from its environment context; never pass the plugin's install directory or another chat's folder. Host-provided thread metadata selects the current chat and its child agents. Set `refresh: true` when the user asks for an update. Hosts that support MCP Apps show the interactive panel; otherwise summarize the tool result.

The header shows the project folder name. Click the scene's level bar to open the growth atlas in the same panel: all nine forms, unlocked/current status, and an estimate from the last seven calendar days. Opening the atlas does not change growth or the main dashboard layout.

Use `sprout_interact` with `action: feed`, `action: pat`, or `action: roast` for the requested pet interaction.

Use `action: pray` for Tibo/rain requests, and `action: cat` to greet or summon CatGPT. Praying changes only the pet animation and dialogue; it never redeems, buys or triggers a real quota reset. Tight quota exposes a clickable cloud in the scene. CatGPT visits briefly once a day, or on request. The three original action buttons stay unchanged.

Repeated care within twelve seconds escalates: second watering burps, third opens an umbrella; second pat protects the sprout, third hides it in the soil. Native session lifecycle metadata drives compaction, long-running work, planning, active subagents, test failure escalation, test recovery and interrupted/completed-turn reactions. With a chat ID, reactions follow that chat and its child agents; a global entry without chat context uses machine activity and leaves an unknown project name blank. Unknown or old events produce no reaction. Do not claim a hook is installed, that tests passed merely because a turn ended, or that Tibo caused an observed quota recovery.

Usage covers retained local Codex sessions, including archived sessions. All history automatically contributes to growth, independently of the dashboard's date filter. It is not the whole ChatGPT account's usage. Cached reads and writes are included in input, and reasoning tokens are included in output; do not add them again. Prices come from OpenAI's official pricing page and are cached for offline use. Keep the panel and normal replies concise; only explain verification dates and assumptions when the user asks about the calculation: these are current-price API-equivalent estimates, not past payments or subscription bills. Unknown models remain unpriced; partial known totals use ≥.

Read quota source and timestamps. Session-derived readings can be stale; forecasts are estimates. Missing quota data does not mean the account has no remaining quota.

The installed plugin runs through Codex-managed stdio. Do not start the standalone HTTP server to open the native panel. Use `sprout_status` so the host loads the MCP App resource. For setup or a host without UI support, see the plugin's `README.md`; standalone HTTP is a development preview only.
