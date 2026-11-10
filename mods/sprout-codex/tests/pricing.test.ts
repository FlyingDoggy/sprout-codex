import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateCost, loadPrices, parseOfficialPrices, PRICING_URL, type Prices } from '../src/server/pricing'
import official from '../src/data/openai-prices.json'
import { writeJson } from '../src/server/storage'
import { zeroTokens } from '../src/model'

const fixture = `### Standard pricing data
| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | $2.00 | $10.00 | $0.10 | $2.50 | $5.00 | $4.00 | $15.00 | $0.20 | $5.00 | $10.00 |
| gpt-6-astra | $10.00 | $50.00 | $1.00 | $12.50 | $25.00 | $20.00 | $75.00 | $2.00 | $25.00 | $50.00 |
| gpt-5.6-sol | $4.00 | $20.00 | $0.40 | $5.00 | $10.00 | $8.00 | $30.00 | $0.80 | $10.00 | $20.00 |
### Fast pricing data
| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-6.1-sol | $4.00 | $20.00 | $0.20 |
### Grouped Pricing Table data
| Model | Input | Output | Cached input |
| gpt-6.1-sol | $999.00 | $999.00 | $999.00 |
`

test('official tables preserve rate columns and separate context lengths and service tiers', () => {
  const { models } = parseOfficialPrices(fixture)
  assert.equal(models['gpt-6.1-sol'].input, 2)
  assert.equal(models['gpt-6.1-sol'].cached, 0.1)
  assert.equal(models['gpt-6.1-sol'].long?.output, 15)
  assert.equal(models['gpt-6.1-sol'].tiers?.fast?.input, 4)
  assert.throws(() => parseOfficialPrices('<html>not a price table</html>'))
  assert.throws(() => parseOfficialPrices(fixture.replace('$2.00', '$unknown')))
})

test('cost separates cached reads, cache writes and reasoning; long context uses per-request input', () => {
  const prices = official.models as Prices
  const tokens = { ...zeroTokens(), input: 1_000_000, cached: 400_000, cacheWrite: 200_000, output: 1_000_000, reasoning: 900_000, total: 2_000_000 }
  assert.equal(estimateCost(tokens, 'gpt-6.1-sol', prices, 200_000, null), 11.34)
  assert.equal(estimateCost(tokens, 'gpt-6.1-sol', prices, 300_000, null), 17.68)
  assert.equal(estimateCost(tokens, 'gpt-6.1-sol-2026-11-01', prices, 200_000, 'priority'), 22.68)
  assert.equal(estimateCost(tokens, 'gpt-6.1-sol-unknown', prices, 200_000, null), null)
  assert.equal(estimateCost(tokens, 'gpt-6.1-sol', prices, 200_000, 'unknown-tier'), null)
  assert.equal(estimateCost(tokens, 'gpt-5.4-pro', prices, 200_000, null), null)
})

test('unavailable or changed official pricing keeps the last good catalog and reports fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sprout-price-'))
  try {
    // Newer than the bundle but old enough to refresh, independent of the test date.
    const realNow = Date.now
    Date.now = () => official.fetchedAt + 4 * 86_400_000
    try {
      await writeJson(join(dir, 'openai-prices.json'), { ...official, fetchedAt: official.fetchedAt + 86_400_000 })
      const failedFetch = async () => new Response('invalid', { status: 502 })
      const old = await loadPrices(dir, true, {}, failedFetch)
      assert.equal(old.info.source, 'cached')
      assert.match(old.info.warning!, /上次核验/)
      assert.equal(old.prices['gpt-6.1-sol'].input, 2)
      const fresh = await loadPrices(dir, true, { custom: { input: 1, cached: 0.1, output: 2 } }, async () => new Response(fixture))
      assert.equal(fresh.info.sourceUrl, PRICING_URL)
      assert.equal(fresh.info.source, 'official')
      assert.deepEqual(fresh.info.customModels, ['custom'])
      assert.equal(fresh.prices.custom.output, 2)
    } finally { Date.now = realNow }
  } finally { await rm(dir, { recursive: true, force: true }) }
})
