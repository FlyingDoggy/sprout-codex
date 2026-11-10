import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(resolve(root, 'dist'), { recursive: true })
const ui = await build({ absWorkingDir: root, tsconfig: resolve(root, 'tsconfig.json'), entryPoints: ['src/ui/main.ts'], bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', minify: true })
const css = await readFile(resolve(root, 'src/ui/style.css'), 'utf8')
const script = ui.outputFiles[0].text.replaceAll('</script', '<\\/script')
await writeFile(resolve(root, 'dist/ui.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>小苗 · Codex</title><style>${css}</style></head><body><div id="app"><main><div class="loading"><strong>小苗正在醒来</strong>正在读取本机用量…</div></main></div><script>${script}</script></body></html>`)
await build({ absWorkingDir: root, tsconfig: resolve(root, 'tsconfig.json'), entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: true, banner: { js: "import { createRequire as sproutCreateRequire } from 'node:module'; const require = sproutCreateRequire(import.meta.url);" } })
console.log('Built Sprout Codex: dist/cli.js + dist/ui.html')
