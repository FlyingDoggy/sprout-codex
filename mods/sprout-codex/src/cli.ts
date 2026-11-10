import { readFile } from 'node:fs/promises'
import { SproutService, optionsFromEnv } from './server/service'
import { demoService } from './server/demo'
import { serve } from './server/http'
import { runMcp } from './server/mcp'
import { readJson } from './server/storage'
import type { Prices } from './server/usage'

async function main() {
  const command = process.argv[2] ?? 'serve'
  if (!['serve', 'status', 'mcp'].includes(command)) {
    console.log('Usage: node dist/cli.js <serve|status|mcp> [--demo] [--port 4317]')
    process.exitCode = command === '--help' || command === '-h' ? 0 : 1
    return
  }
  const options = optionsFromEnv()
  if (process.env.SPROUT_PRICES_FILE) options.prices = await readJson<Prices>(process.env.SPROUT_PRICES_FILE, {})
  const service = process.argv.includes('--demo') ? demoService() : new SproutService(options)
  if (command === 'status') { console.log(JSON.stringify(await service.get(), null, 2)); return }
  const html = await readFile(new URL('./ui.html', import.meta.url), 'utf8')
  if (command === 'mcp') { await runMcp(service, html); return }
  const index = process.argv.indexOf('--port')
  const port = Number(index >= 0 ? process.argv[index + 1] : process.env.SPROUT_PORT ?? 4317)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须介于 1 与 65535。')
  const server = await serve(service, html, port)
  console.log(`小苗已启动：http://127.0.0.1:${port}${process.argv.includes('--demo') ? '（演示模式）' : ''}`)
  const close = () => { server.close(); server.closeAllConnections(); process.exitCode = 0 }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
