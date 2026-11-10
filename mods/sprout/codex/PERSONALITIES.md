# Codex personalities

This edition extends the shared Sprout mod. It keeps the author's scene, charts, scan, MCP transport and build-free Node runtime. The `codex/sprout-port` branch is the upstream contribution; `codex/sprout-personality` adds static personalities; `codex/sprout-llm` adds optional generation.

Click the project folder name in the top right to choose a personality or refresh. Selection and edits to local packs take effect on the next draw without restarting Codex. Changing plugin versions still requires reloading the plugin. Switching personality does not reset usage, growth or care counters.

`classic` uses the author's lines. `delivery` adds consulting, slides, commercial, research, teaching, coding, media and personal tasks while retaining suitable original lines. Manual roasts alternate two task lines with one aside when a task is known. Water, pat and roast keep separate rotations. Non-code work does not get instructions to go write code.

Settings remain in `$CODEX_HOME/sprout` (default `~/.codex/sprout`):

- `personality.json`: `{ "schemaVersion": 1, "persona": "delivery" }`. Existing generation settings are preserved but this static branch never executes a model.
- `personas/<id>.json`: local packs, including the existing private Muyu pack. Required fields: `schemaVersion: 1`, `id`, `version`, `name`. Optional fields: `extends: "classic" | "delivery"`, `identity`, `voice`, `inheritOriginal`, `pools`, `scenes`, `signals`.
- `preferences.json`: sourced preferences. The static edition preserves them; it does not automatically rewrite dialogue from memory.
- `store/persona-dialogue.json`: bounded rotation state, separate from the author's counters and growth.

Pack lines must fit the original three-line bubble. Invalid packs are omitted from the menu; a failed selection leaves the current configuration intact. A malformed active configuration falls back to classic until corrected. The built-in dialogue lists are in `personas.ts`; original lines remain in `hooks/lines.ts` and `codex/lines.ts`.

From `mods/sprout`:

```sh
node --import ./codex/loader.mjs codex/personality-cli.ts list
node --import ./codex/loader.mjs codex/personality-cli.ts use delivery
node --import ./codex/loader.mjs codex/personality-cli.ts show
node --import ./codex/loader.mjs codex/personality-cli.ts remember /absolute/path/preference.json
```

Task classification reads only the current named chat's recent user requests. It keeps closed-set labels, not prompt text. No named chat means no inferred task from another chat. Attachments and injected environment instructions are excluded. A generic “continue” retains the previous labels. The phrase “可编辑的 PPT，别他妈交一叠截图。” is in the `artifact` signal pool, which requires a slides task plus editable/native/export delivery wording.

Local packs, preferences, scan caches and account data are not part of the release. The optional generation edition is maintained separately and defaults to off.
