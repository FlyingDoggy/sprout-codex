import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
