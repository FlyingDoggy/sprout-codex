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
import { personalityCommand } from '../src/server/personality-cli'
import { writeJson, readJson } from '../src/server/storage'
import { companion } from '../src/core/companion'
import type { Dashboard } from '../src/model'

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
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['sprout_interact', 'sprout_personality', 'sprout_status'])
    assert.deepEqual((tools.tools.find(tool => tool.name === 'sprout_personality')?._meta?.ui as any).visibility,['app'])
    assert.deepEqual(tools.tools.find(tool => tool.name === 'sprout_status')?._meta?.['openai/ui'], { entrypoints: [{ type: 'thread' }, { type: 'global' }] })
    const status = await client.callTool({ name: 'sprout_status', arguments: {} })
    assert.equal((status.structuredContent as any).demo, true)
    const resource = await client.readResource({ uri: 'ui://sprout/dashboard-llm-v2.html' })
    assert.ok('text' in resource.contents[0])
    assert.match(resource.contents[0].text, /小苗/)
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app')
    const pet = await client.callTool({ name: 'sprout_interact', arguments: { action: 'feed' } })
    assert.equal((pet.structuredContent as any).fed, 13)
    const roast = await client.callTool({ name: 'sprout_interact', arguments: { action: 'roast' } })
    assert.equal((roast.structuredContent as any).fed, 13)
    assert.equal((roast.structuredContent as any).patted, 28)
    assert.ok((roast.structuredContent as any).line)
    assert.notEqual((roast.structuredContent as any).line.bucket,'feed')
    const prayer = await client.callTool({ name: 'sprout_interact', arguments: { action: 'pray' } })
    assert.equal((prayer.structuredContent as any).prayed, 1)
    assert.equal((prayer.structuredContent as any).fed, 13)
    const cat = await client.callTool({ name: 'sprout_interact', arguments: { action: 'cat' } })
    assert.equal((cat.structuredContent as any).line.bucket, 'cat')
    assert.ok((cat.structuredContent as any).cat.until > Date.now())
    const after = await client.callTool({ name: 'sprout_status', arguments: {} })
    assert.deepEqual((after.structuredContent as any).quota, (status.structuredContent as any).quota)
    assert.doesNotMatch(resource.contents[0].text, /不是订阅账单|成长值不受下方时间筛选影响|价格来源与模型明细/)
    const selected = await client.callTool({ name:'sprout_personality',arguments:{persona:'delivery'} })
    assert.equal((selected.structuredContent as any).dialogue.personaId,'delivery')
    const invalid = await client.callTool({ name: 'sprout_interact', arguments: { action: 'delete' } })
    assert.equal(invalid.isError, true)
  } finally { await client.close(); await rm(packaged, { recursive: true, force: true }) }
})

test('stdio plugin calculates historical costs and retains pet state across process restarts without HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-restart-'))
  try {
    await mkdir(join(root, 'archived_sessions'))
    await mkdir(join(root, 'sessions'))
    await writeFile(join(root, 'archived_sessions/history.jsonl'), [
      { type: 'session_meta', payload: { id: 'alpha', cwd: '/work/Audi BI PoC', source: 'cli' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      { timestamp: '2025-01-01T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 100_000 } } } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n')
    const now = Date.now()
    await writeFile(join(root, 'sessions/beta.jsonl'), [
      { type: 'session_meta', payload: { id:'beta', cwd:'/work/Unrelated', source:'cli' } },
      { type:'event_msg', timestamp:new Date(now-1000).toISOString(), payload:{type:'task_started',turn_id:'beta-turn'} },
      { type:'event_msg', timestamp:new Date(now).toISOString(), payload:{type:'item_completed',item:{id:'failed-test',type:'CommandExecution',command:['/bin/zsh','-lc','npm test'],exit_code:1}} },
    ].map(row=>JSON.stringify(row)).join('\n')+'\n')
    for (let run = 0; run < 2; run++) {
      const client = new Client({ name: 'sprout-restart', version: '1.0.0' })
      const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp'], env: { SPROUT_CODEX_HOME: root, SPROUT_DATA_DIR: join(root, 'state'), SPROUT_GITHUB: '0', SPROUT_LIVE_QUOTA: '0', SPROUT_PRICE_REFRESH: '0' }, stderr: 'pipe' })
      try {
        await client.connect(transport)
        const { structuredContent: d } = await client.callTool({ name: 'sprout_status', arguments: {}, _meta:{'x-codex-turn-metadata':JSON.stringify({thread_id:'alpha'})} })
        assert.equal((d as any).usage.totals.total, 1_100_000)
        assert.equal((d as any).usage.totals.costUsd, 2.05)
        assert.equal((d as any).pet.fed, run)
        assert.equal((d as any).projectName, 'Audi BI PoC')
        assert.equal((d as any).activity.active, 0)
        assert.equal((d as any).activity.event, null)
        assert.equal((d as any).usage.activityStates, undefined)
        const other = await client.callTool({name:'sprout_status',arguments:{threadId:'beta'}})
        assert.equal((other.structuredContent as any).projectName, 'Unrelated')
        assert.equal((other.structuredContent as any).activity.event.kind, 'test_failed')
        if (run === 0) await client.callTool({ name: 'sprout_interact', arguments: { action: 'feed' } })
      } finally { await client.close() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one running MCP process hot-switches personalities repeatedly without touching pet state or usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-hot-switch-'))
  const dataDir = join(root, 'state')
  const client = new Client({ name:'sprout-hot-switch', version:'1' })
  const packPath = join(dataDir,'personas','switch-test.json')
  const pack = { schemaVersion:1,id:'switch-test',version:'1',extends:'delivery',inheritOriginal:false,name:'测试人设',pools:{feed:['一号人设，水收到了。','一号人设，先坐会儿。']} }
  try {
    await mkdir(join(root,'sessions'))
    await writeFile(join(root,'sessions','history.jsonl'), [
      { type:'session_meta',payload:{id:'chat',cwd:'/work/Project',source:'cli'} },
      { type:'turn_context',payload:{model:'gpt-6.1-sol'} },
      { timestamp:'2025-01-01T00:00:00Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:20e9,output_tokens:100}}} },
    ].map(row=>JSON.stringify(row)).join('\n')+'\n')
    await writeJson(packPath,pack)
    await writeJson(join(dataDir,'personality.json'),{schemaVersion:1,persona:'classic',generation:{enabled:false}})
    const transport = new StdioClientTransport({ command:process.execPath,args:[resolve('dist/cli.js'),'mcp'],env:{SPROUT_CODEX_HOME:root,SPROUT_DATA_DIR:dataDir,SPROUT_GITHUB:'0',SPROUT_LIVE_QUOTA:'0',SPROUT_PRICE_REFRESH:'0'},stderr:'pipe' })
    await client.connect(transport)
    const status = async () => (await client.callTool({ name:'sprout_status',arguments:{threadId:'chat'} })).structuredContent as Dashboard
    await status()
    await client.callTool({ name:'sprout_interact',arguments:{action:'feed',threadId:'chat'} })
    const baseline = await status()
    const state = await readFile(join(dataDir,'pet.json'),'utf8')
    const pid = transport.pid
    for (let i=0;i<30;i++) {
      const id = ['classic','delivery','switch-test'][i%3]
      const switched = await client.callTool({name:'sprout_personality',arguments:{persona:id,threadId:'chat'}})
      assert.notEqual(switched.isError,true)
      const d = switched.structuredContent as Dashboard
      assert.equal(d.dialogue?.personaId,id)
      assert.deepEqual(d.pet,baseline.pet)
      assert.deepEqual(d.usage,baseline.usage)
      assert.deepEqual(d.quota,baseline.quota)
      assert.equal(transport.pid,pid)
      if (id==='switch-test') assert.ok(pack.pools.feed.includes(companion(d).text))
    }
    const edited = {...pack,version:'2',pools:{feed:['二号台词，已经换好了。','二号台词，花盆还在。']}}
    await writeJson(packPath,edited)
    assert.ok(edited.pools.feed.includes(companion(await status()).text),'editing the selected pack hot-loads too')
    await assert.rejects(personalityCommand(dataDir,['use','missing']))
    const missing = await client.callTool({name:'sprout_personality',arguments:{persona:'missing'}})
    assert.equal(missing.isError,true)
    const menu = await client.callTool({name:'sprout_personality',arguments:{}})
    assert.deepEqual(menu.structuredContent,{current:'switch-test',choices:[{id:'classic',name:'原版小苗'},{id:'delivery',name:'交付搭子'},{id:'switch-test',name:'测试人设'}]})
    assert.equal((await status()).dialogue?.personaId,'switch-test','a missing pack cannot replace the current selection')
    await writeFile(packPath,'{broken')
    assert.equal((await status()).dialogue,undefined,'invalid active data falls back to the original lines')
    await writeJson(packPath,edited)
    assert.equal((await status()).dialogue?.personaId,'switch-test','repairing the file recovers without restarting')
    assert.equal(await readFile(join(dataDir,'pet.json'),'utf8'),state)
    assert.equal(await readJson(join(dataDir,'dialogue-cache.json'),null),null,'switching never enables generation')
  } finally { await client.close(); await rm(root,{recursive:true,force:true}) }
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
    assert.equal((await (await fetch(`${base}/api/personality`)).json()).current,'classic')
    assert.equal((await fetch(`${base}/api/personality`,{method:'POST',body:'{"persona":"delivery"}'})).status,403)
    const headers = {'Content-Type':'application/json','X-Sprout-Request':'1'}
    assert.equal((await fetch(`${base}/api/personality`,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{"persona":"delivery"}'})).status,403)
    const changed = await fetch(`${base}/api/personality`,{method:'POST',headers,body:'{"persona":"delivery"}'})
    assert.equal((await changed.json()).dialogue.personaId,'delivery')
    for (const persona of ['missing','../classic']) assert.equal((await fetch(`${base}/api/personality`,{method:'POST',headers,body:JSON.stringify({persona})})).status,400)
    assert.equal((await (await fetch(`${base}/api/personality`)).json()).current,'delivery')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
