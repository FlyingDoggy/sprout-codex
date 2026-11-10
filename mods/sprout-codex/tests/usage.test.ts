import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aggregate, consumeLine, freshScan, scanUsage, tokenUsage } from '../src/server/usage'

const event = (at: string, input: number, output: number, cached = 0, reasoning = 0) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached, reasoning_output_tokens: reasoning, total_tokens: input + output } } } })
const context = JSON.stringify({ type: 'turn_context', payload: { model: 'test-model' } })

test('cached input and reasoning output are subsets, not additional tokens', () => {
  assert.deepEqual(tokenUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 50, reasoning_output_tokens: 30 }), { input: 100, cached: 80, output: 50, reasoning: 30, total: 150 })
})
test('repeated cumulative snapshots, stale events, and copied histories count once', () => {
  const scan = freshScan()
  consumeLine(scan, context)
  consumeLine(scan, event('2026-11-09T23:50:00Z', 100, 20, 50, 5))
  consumeLine(scan, event('2026-11-09T23:51:00Z', 100, 20, 50, 5))
  consumeLine(scan, event('2026-11-09T23:52:00Z', 90, 10, 40, 2))
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
