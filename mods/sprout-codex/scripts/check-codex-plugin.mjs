import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = await mkdtemp(join(tmpdir(), 'sprout-codex-host-'))
const marketplace = join(scratch, 'marketplace')
const plugin = join(marketplace, 'plugins/sprout-codex')
const codexHome = join(scratch, 'codex-home')
await mkdir(plugin, { recursive: true })
await mkdir(codexHome)
await mkdir(join(marketplace, '.agents/plugins'), { recursive: true })
for (const path of ['.codex-plugin', '.mcp.json', 'dist', 'skills', 'package.json', 'README.md', 'INSTALL.md']) await cp(join(root, path), join(plugin, path), { recursive: true })
const marketplacePath = join(marketplace, '.agents/plugins/marketplace.json')
await writeFile(marketplacePath, JSON.stringify({ name: 'sprout-smoke', plugins: [{ name: 'sprout-codex', source: { source: 'local', path: './plugins/sprout-codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }))

function connect() {
  const child = spawn(process.env.SPROUT_CODEX_BIN ?? 'codex', ['app-server', '--stdio'], { env: { ...process.env, CODEX_HOME: codexHome, SPROUT_GITHUB: '0', SPROUT_LIVE_QUOTA: '0' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const reader = createInterface({ input: child.stdout })
  const pending = new Map()
  let counter = 0
  child.stderr.resume()
  child.on('error', error => { for (const item of pending.values()) item.reject(error) })
  reader.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const item = pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer); pending.delete(message.id)
    if (message.error) item.reject(new Error(message.error.message))
    else item.resolve(message.result)
  })
  return {
    call(method, params) {
      const id = ++counter
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 20_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n')
      })
    },
    notify(method) { child.stdin.write(JSON.stringify({ method }) + '\n') },
    async close() {
      reader.close(); child.stdin.end(); child.kill('SIGTERM')
      for (const item of pending.values()) clearTimeout(item.timer)
      if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 1000); child.once('exit', () => { clearTimeout(timer); resolve() }) })
    },
  }
}
async function init(client) {
  await client.call('initialize', { clientInfo: { name: 'sprout_smoke', version: '1.0.0' }, capabilities: null })
  client.notify('initialized')
}
let client
try {
  client = connect(); await init(client)
  await client.call('plugin/install', { marketplacePath, pluginName: 'sprout-codex' })
  await client.close()
  client = connect(); await init(client)
  const result = await client.call('mcpServer/resource/read', { server: 'sprout', uri: 'ui://sprout/dashboard-llm-v3.html' })
  assert.ok(JSON.stringify(result).includes('小苗'))
  console.log('Codex installed the isolated plugin and read its MCP App resource successfully.')
} finally {
  if (client) await client.close()
  await rm(scratch, { recursive: true, force: true })
}
