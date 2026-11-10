import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, rename, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate, consumeLine, freshScan, scanUsage, tokenUsage } from '../src/server/usage'

const event = (at: string, input: number, output: number, cached = 0, reasoning = 0) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached, reasoning_output_tokens: reasoning, total_tokens: input + output } } } })
const context = JSON.stringify({ type: 'turn_context', payload: { model: 'test-model' } })

test('cached input and reasoning output are subsets, not additional tokens', () => {
  assert.deepEqual(tokenUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 50, reasoning_output_tokens: 30 }), { input: 100, cached: 80, cacheWrite: 0, output: 50, reasoning: 30, total: 150 })
})
test('repeated cumulative snapshots, stale events, and copied histories count once', () => {
  const scan = freshScan()
  consumeLine(scan, context)
  consumeLine(scan, event('2026-11-09T23:50:00Z', 100, 20, 50, 5))
  consumeLine(scan, event('2026-11-09T23:51:00Z', 100, 20, 50, 5))
  consumeLine(scan, event('2026-11-09T23:49:00Z', 90, 10, 40, 2))
  consumeLine(scan, event('2026-11-10T16:01:00Z', 150, 30, 70, 9))
  const result = aggregate([scan, structuredClone(scan)], 'Asia/Shanghai', { 'test-model': { input: 2, cached: 1, output: 4 } })
  assert.equal(result.totals.total, 180)
  assert.equal(result.totals.cached, 70)
  assert.equal(result.totals.costUsd, 0.00035)
  assert.deepEqual(result.days.map(day => [day.day, day.total]), [['2026-11-10', 120], ['2026-11-11', 60]])
})
test('missing pricing stays unknown and zero usage remains empty', () => {
  const scan = freshScan()
  consumeLine(scan, 'malformed')
  consumeLine(scan, event('2026-11-10T00:00:00Z', 100, 10))
  const result = aggregate([scan], 'UTC')
  assert.equal(result.totals.costUsd, null)
  assert.deepEqual(result.unpricedModels, ['unknown'])
  assert.equal(aggregate([], 'UTC').firstDay, null)
})
test('partial pricing retains known costs and reports token coverage without hiding unknown models', () => {
  const scan = freshScan()
  consumeLine(scan, context)
  consumeLine(scan, event('2026-11-10T00:00:00Z', 100, 10))
  consumeLine(scan, JSON.stringify({ type: 'turn_context', payload: { model: 'unpublished' } }))
  consumeLine(scan, event('2026-11-10T00:01:00Z', 200, 20))
  const data = aggregate([scan], 'UTC', { 'test-model': { input: 2, cached: 1, output: 4 } })
  assert.equal(data.totals.costUsd, null)
  assert.equal(data.days[0].knownCostUsd, 0.00024)
  assert.equal(data.days[0].pricedTokens, 110)
  assert.equal(data.totals.total, 220)
  assert.deepEqual(data.unpricedModels, ['unpublished'])
})
test('request context is taken from the last usage, never the growing session total', () => {
  const scan = freshScan()
  consumeLine(scan, JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'test-model', service_tier: 'priority' } } }))
  consumeLine(scan, context)
  for (let i = 1; i <= 3; i++) {
    const row = JSON.parse(event(`2026-11-10T00:0${i}:00Z`, i * 200_000, i * 100))
    row.payload.info.last_token_usage = { input_tokens: 200_000, output_tokens: 100 }
    consumeLine(scan, JSON.stringify(row))
  }
  const data = aggregate([scan], 'UTC', { 'test-model': { input: 1, cached: 0, output: 1, long: { input: 9, cached: 0, output: 9 }, tiers: { fast: { input: 2, cached: 0, output: 2, long: { input: 18, cached: 0, output: 18 } } } } })
  assert.ok(Math.abs(data.totals.costUsd! - 1.2006) < 1e-12)
  assert.equal(data.costAssumptions.standardTierEvents, 0)
  assert.equal(data.costAssumptions.shortContextEvents, 0)
})
test('incremental scans handle incomplete tails, archive moves, truncation and deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-usage-'))
  try {
    const sessions = join(root, 'sessions')
    const archived = join(root, 'archived_sessions')
    await mkdir(sessions); await mkdir(archived)
    const path = join(sessions, 'test.jsonl')
    const data = join(root, 'state')
    const first = event('2026-11-10T00:00:00Z', 100, 10)
    const second = event('2026-11-10T00:01:00Z', 160, 20)
    await writeFile(path, `${context}\n${first}\n${second.slice(0, 40)}`)
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 110)
    await appendFile(path, `${second.slice(40)}\n`)
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 180)
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 180)
    await rename(path, join(archived, 'test.jsonl'))
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 180)
    await writeFile(join(archived, 'test.jsonl'), `${first}\n`)
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 110)
    await rm(join(archived, 'test.jsonl'))
    assert.equal((await scanUsage(root, data, 'UTC')).totals.total, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('port caches are reclassified for task context without changing token totals', async () => {
  const root=await mkdtemp(join(tmpdir(),'sprout-desktop-history-'))
  try {
    await mkdir(join(root,'sessions'))
    const data=join(root,'state'), path=join(root,'sessions','desktop.jsonl')
    const rows=[
      {type:'session_meta',payload:{id:'desktop-chat',cwd:'/private/project'}},
      {type:'response_item',timestamp:'2026-11-10T00:00:00Z',payload:{type:'message',role:'user',content:[{type:'input_text',text:'PRIVATE CLIENT，只修改这一页的 PPT，保留母版。'}]}},
      JSON.parse(event('2026-11-10T00:01:00Z',100,10)),
    ]
    await writeFile(path,rows.map(row=>JSON.stringify(row)).join('\n')+'\n')
    const before=await scanUsage(root,data,'UTC')
    const db=new DatabaseSync(join(data,'usage-v1.sqlite'))
    const state=JSON.parse((db.prepare('SELECT state FROM files WHERE path=?').get(path) as any).state)
    state.version=1
    delete state.activity.task
    db.prepare('UPDATE files SET state=? WHERE path=?').run(JSON.stringify(state),path)
    db.close()
    const after=await scanUsage(root,data,'UTC')
    assert.deepEqual(after.totals,before.totals)
    assert.equal(after.activityStates[0].task?.scenario,'slides')
    assert.deepEqual(after.activityStates[0].task?.signals,['layout'])
    const next=new DatabaseSync(join(data,'usage-v1.sqlite'),{readOnly:true})
    const stored=(next.prepare('SELECT state FROM files WHERE path=?').get(path) as any).state
    assert.doesNotMatch(stored,/PRIVATE CLIENT|母版/)
    assert.equal(JSON.parse(stored).version,2)
    next.close()
  } finally { await rm(root,{recursive:true,force:true}) }
})
