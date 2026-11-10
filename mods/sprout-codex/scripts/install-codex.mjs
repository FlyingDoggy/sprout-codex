import { cp, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major >= 24 || major === 22 && minor >= 16)) throw new Error('小苗需要 Node.js 22.16+（22.x）或 24+，用于 SQLite 与 Zstandard 日志读取。')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')
const source = join(codexHome, 'plugins/sources/muyu-sprout')
const plugin = join(source, 'plugins/sprout-codex')
// Stage only distributable files. Never copy development logs, user statistics or node_modules.
await mkdir(plugin, { recursive: true })
for (const file of ['.codex-plugin/plugin.json', 'dist/cli.js', 'dist/ui.html', 'skills/sprout/SKILL.md', 'package.json', 'README.md', 'INSTALL.md', 'NOTICE.md']) {
  const target = join(plugin, file)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(root, file), `${target}.tmp`)
  await rename(`${target}.tmp`, target)
}
const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'))
// The desktop app need not inherit a terminal's Node PATH.
mcp.mcpServers.sprout.command = process.execPath
const binary = process.env.SPROUT_CODEX_BIN ?? 'codex'
let resolvedBinary = binary
try { resolvedBinary = execFileSync('which', [binary], { encoding: 'utf8' }).trim() } catch {}
mcp.mcpServers.sprout.env = { SPROUT_CODEX_BIN: resolvedBinary }
await writeFile(join(plugin, '.mcp.json'), JSON.stringify(mcp, null, 2) + '\n')
const catalog = { name: 'muyu-sprout', interface: { displayName: 'Muyu · 小苗' }, plugins: [{ name: 'sprout-codex', source: { source: 'local', path: './plugins/sprout-codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }
await mkdir(join(source, '.agents/plugins'), { recursive: true })
await writeFile(join(source, '.agents/plugins/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n')
execFileSync(binary, ['plugin', 'marketplace', 'add', source], { stdio: 'inherit' })
execFileSync(binary, ['plugin', 'add', 'sprout-codex@muyu-sprout'], { stdio: 'inherit' })
console.log('小苗已安装：由 Codex 管理 stdio 进程，无需启动网页服务。重新加载客户端后使用「打开小苗」。')
