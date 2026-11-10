import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, copyFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { demoService } from '../src/server/demo'
import { serve } from '../src/server/http'

test('MCP stdio handshake, dashboard data, UI resource and pet action work end to end', async () => {
  const packaged = await mkdtemp(join(tmpdir(), 'sprout-package-'))
  await copyFile(resolve('dist/cli.js'), join(packaged, 'cli.js'))
  await copyFile(resolve('dist/ui.html'), join(packaged, 'ui.html'))
  await writeFile(join(packaged, 'package.json'), '{"type":"module"}')
  const client = new Client({ name: 'sprout-test', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(packaged, 'cli.js'), 'mcp', '--demo'], cwd: packaged, stderr: 'pipe' })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['sprout_interact', 'sprout_status'])
    assert.deepEqual(tools.tools.find(tool => tool.name === 'sprout_status')?._meta?.['openai/ui'], { entrypoints: [{ type: 'thread' }, { type: 'global' }] })
    const status = await client.callTool({ name: 'sprout_status', arguments: {} })
    assert.equal((status.structuredContent as any).demo, true)
    const resource = await client.readResource({ uri: 'ui://sprout/dashboard-v3.html' })
    assert.ok('text' in resource.contents[0])
    assert.match(resource.contents[0].text, /小苗/)
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app')
    const pet = await client.callTool({ name: 'sprout_interact', arguments: { action: 'feed' } })
    assert.equal((pet.structuredContent as any).fed, 13)
    const roast = await client.callTool({ name: 'sprout_interact', arguments: { action: 'roast' } })
    assert.equal((roast.structuredContent as any).fed, 13)
    assert.equal((roast.structuredContent as any).patted, 28)
    assert.ok((roast.structuredContent as any).line)
    assert.doesNotMatch(resource.contents[0].text, /不是订阅账单|成长值不受下方时间筛选影响|价格来源与模型明细/)
    const invalid = await client.callTool({ name: 'sprout_interact', arguments: { action: 'delete' } })
    assert.equal(invalid.isError, true)
  } finally { await client.close(); await rm(packaged, { recursive: true, force: true }) }
})

test('stdio plugin calculates historical costs and retains pet state across process restarts without HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-restart-'))
  try {
    await mkdir(join(root, 'archived_sessions'))
    await writeFile(join(root, 'archived_sessions/history.jsonl'), [
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      { timestamp: '2025-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 100_000 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n')
    for (let run = 0; run < 2; run++) {
      const client = new Client({ name: 'sprout-restart', version: '1.0.0' })
      const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp'], env: { SPROUT_CODEX_HOME: root, SPROUT_DATA_DIR: join(root, 'state'), SPROUT_GITHUB: '0', SPROUT_LIVE_QUOTA: '0', SPROUT_PRICE_REFRESH: '0' }, stderr: 'pipe' })
      try {
        await client.connect(transport)
        const { structuredContent: d } = await client.callTool({ name: 'sprout_status', arguments: {} })
        assert.equal((d as any).usage.totals.total, 1_100_000)
        assert.equal((d as any).usage.totals.costUsd, 2.05)
        assert.equal((d as any).pet.fed, run)
        if (run === 0) await client.callTool({ name: 'sprout_interact', arguments: { action: 'feed' } })
      } finally { await client.close() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('standalone UI serves data and rejects cross-origin and rebinding requests', async () => {
  const html = await readFile('dist/ui.html', 'utf8')
  const server = await serve(demoService(), html, 0)
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  try {
    assert.match(await (await fetch(base)).text(), /小苗/)
    assert.equal((await (await fetch(`${base}/api/status`)).json()).demo, true)
    const rebindingStatus = await new Promise(resolve => get(`${base}/api/status`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode) }))
    assert.equal(rebindingStatus, 403)
    assert.equal((await fetch(`${base}/api/status`, { headers: { Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(`${base}/api/interact`, { method: 'POST', body: '{"action":"feed"}' })).status, 403)
    const response = await fetch(`${base}/api/interact`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sprout-Request': '1' }, body: '{"action":"pat"}' })
    assert.equal((await response.json()).patted, 29)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
