# Upstream provenance

The pixel character, growth levels, forecasting helpers, bilingual quips and SVG charts originate from QingqiShi/claude, `mods/sprout`, commit `acd822e7f036d777d26f0c6e08cef889973b182e`.

The Codex adapter imports the pure modules in `../sprout/hooks/` directly. No independent copies of the level tables, forecasting code, sprites, chart animations or original quip pools are maintained. Host adapters in `src/core/` add Codex wording, typography, scene decorations and interaction routing. The shared renderer's defaults retain Claude's output; regression snapshots cover both languages and all nine growth stages.

The shared language helper accepts a structural settings/environment reader without a Claude runtime import. The original Claude entry point and runtime configuration remain in `mods/sprout`; Codex has its own collector, persistence, transport, installer and tests. The committed bundles include shared modules, so the installed plugin does not need the source checkout.

Upstream: https://github.com/QingqiShi/claude/tree/main/mods/sprout

This notice records provenance and does not assign a new license to upstream code.
