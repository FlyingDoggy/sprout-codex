import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SproutService, type Options } from '../src/server/service'

test('pet interactions persist across instances without lost concurrent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-pet-'))
  try {
    const opts: Options = { codexHome: root, dataDir: join(root, 'state'), timezone: 'Asia/Shanghai', binary: 'codex', live: false, github: false, prices: {} }
    const services = [new SproutService(opts), new SproutService(opts)]
    await Promise.all(Array.from({ length: 8 }, (_, i) => services[i % 2].interact(i % 2 ? 'pat' : 'feed')))
    const dashboard = await new SproutService(opts).get()
    assert.equal(dashboard.pet.fed, 4)
    assert.equal(dashboard.pet.patted, 4)
    assert.equal(dashboard.usage.totals.total, 0)
    assert.equal(dashboard.quota.source, 'unavailable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('growth imports old and archived history, deduplicates forks, and persists the earned level', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-history-'))
  try {
    await mkdir(join(root, 'sessions')); await mkdir(join(root, 'archived_sessions'))
    const record = (date: string, input: number) => JSON.stringify({ timestamp: date, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 100 } } } }) + '\n'
    const old = record('2025-01-01T00:00:00Z', 20_000_000_000)
    await writeFile(join(root, 'archived_sessions/old.jsonl'), old)
    await writeFile(join(root, 'sessions/fork.jsonl'), old)
    await writeFile(join(root, 'sessions/recent.jsonl'), record(new Date().toISOString(), 1000))
    const opts: Options = { codexHome: root, dataDir: join(root, 'state'), timezone: 'UTC', binary: 'codex', live: false, github: false, prices: {} }
    const first = await new SproutService(opts).get()
    assert.equal(first.pet.highest, 2)
    assert.equal(first.usage.totals.total, 20_000_001_200)
    assert.equal(first.usage.firstDay, '2025-01-01')
    assert.deepEqual((await new SproutService(opts).get()).usage.totals, first.usage.totals)
    assert.equal((await new SproutService(opts).interact('feed')).highest, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
