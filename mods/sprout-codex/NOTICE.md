# Upstream provenance

The pixel character, growth levels, scene drawing, forecasting helpers and SVG charts originate from QingqiShi/claude, `mods/sprout`, commit `acd822e7f036d777d26f0c6e08cef889973b182e`.

- `src/core/levels.ts`, `logic.ts`, `scene.ts`, `svg-kit.ts`, and `panels.ts` are copied from the corresponding upstream hook files.
- `src/types/index.ts` keeps the upstream data types without the Claude runtime module augmentation.
- `src/core/i18n.ts` replaces the Claude settings adapter with a host-independent language selector.
- Codex collection, persistence, transport, web UI, packaging and tests are implemented in this fork.

Upstream: https://github.com/QingqiShi/claude/tree/main/mods/sprout

This notice records provenance and does not assign a new license to upstream code.
