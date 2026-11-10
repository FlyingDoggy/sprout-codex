import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SproutService, type Options } from '../src/server/service'
import { companion } from '../src/core/companion'
import { demoDashboard } from '../src/server/demo'

test('roasts cycle contextual lines and survive restarts without changing counters, tokens or level', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-roast-'))
  try {
    const opts: Options = { codexHome: root, dataDir: join(root, 'state'), timezone: 'Asia/Shanghai', binary: 'codex', live: false, github: false, prices: {} }
    await mkdir(opts.dataDir)
    // A 0.2.0 pet has no line or celebration fields.
    await writeFile(join(opts.dataDir, 'pet.json'), JSON.stringify({ fed: 7, patted: 9, highest: 2, action: null, actionAt: 0 }))
    const service = new SproutService(opts)
    const before = await service.refresh()
    const first = await service.interact('roast')
    const firstText = companion({ ...before, pet: first }).text
    const restarted = new SproutService(opts)
    const second = await restarted.interact('roast')
    await restarted.settled()
    assert.notEqual(companion({ ...before, pet: second }).text, firstText)
    assert.equal(second.line!.index, first.line!.index + 1)
    assert.equal(second.fed, 7); assert.equal(second.patted, 9); assert.equal(second.highest, 2)
    assert.equal(second.actionAt, 0)
    assert.deepEqual(JSON.parse(await readFile(join(opts.dataDir, 'pet.json'), 'utf8')).line, second.line)
    assert.equal((await service.get()).usage.totals.total, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('companion selects quota, night, streak, pat and level-up moods without unresolved placeholders', () => {
  const now = Date.parse('2026-11-10T04:00:00Z')
  const d = demoDashboard(now)
  d.pet.action = null; d.pet.actionAt = 0
  d.pet.levelUpUntil = now + 10_000
  assert.equal(companion(d, now).moodKey, 'levelup')
  assert.equal(companion(d, now).isConfetti, true)
  d.pet.levelUpUntil = 0
  d.pet.action = 'pat'; d.pet.actionAt = now
  assert.equal(companion(d, now).mood, 'party')
  d.pet.action = null
  d.quota.windows[0].usedPercent = 100
  assert.equal(companion(d, now).mood, 'sleep')
  d.quota.windows[0].usedPercent = 95
  assert.equal(companion(d, now).moodKey, 'worry')
  d.quota.windows[0].usedPercent = 20
  const night = Date.parse('2026-11-09T18:00:00Z')
  assert.equal(companion(d, night).moodKey, 'night')
  for (let i = 0; i < 30; i++) {
    d.pet.line = { bucket: 'worry', index: i, at: now }
    d.quota.windows[0].usedPercent = 95
    assert.doesNotMatch(companion(d, now).text, /\{\w+\}|5 小时/)
  }
})

test('pet interactions persist across instances without lost concurrent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-pet-'))
  try {
    const opts: Options = { codexHome: root, dataDir: join(root, 'state'), timezone: 'Asia/Shanghai', binary: 'codex', live: false, github: false, prices: {} }
    const services = [new SproutService(opts), new SproutService(opts)]
    await Promise.all(Array.from({ length: 8 }, (_, i) => services[i % 2].interact(i % 2 ? 'pat' : 'feed')))
    const dashboard = await new SproutService(opts).refresh()
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
    const first = await new SproutService(opts).refresh()
    assert.equal(first.pet.highest, 2)
    assert.equal(first.usage.totals.total, 20_000_001_200)
    assert.equal(first.usage.firstDay, '2025-01-01')
    assert.deepEqual((await new SproutService(opts).refresh()).usage.totals, first.usage.totals)
    assert.equal((await new SproutService(opts).interact('feed')).highest, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
