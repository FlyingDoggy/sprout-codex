import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getQuota, normalizeQuota, readRateLimits } from '../src/server/codex'

const now = 1794268800000
test('quota supports arbitrary windows, multiple buckets and snake_case session payloads', () => {
  const live = normalizeQuota({ rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 55, windowDurationMins: 10080, resetsAt: now / 1000 + 1000 } }, other: { limitId: 'other', primary: { usedPercent: 20, windowDurationMins: 15, resetsAt: now / 1000 + 300 } } } }, now, now)
  assert.equal(live.length, 2)
  assert.equal(live[0].windowMinutes, 10080)
  const legacy = normalizeQuota({ limit_id: 'codex', primary: { used_percent: 55, window_minutes: 10080, resets_at: now / 1000 + 1000 } }, now, now)
  assert.deepEqual(legacy, [live[0]])
})
test('expired and malformed quotas never look like refreshed zero usage', () => {
  assert.deepEqual(normalizeQuota({ primary: { used_percent: 55, window_minutes: 300, resets_at: now / 1000 - 1 } }, now, now), [])
  assert.deepEqual(normalizeQuota({ primary: { used_percent: '55', window_minutes: 300 } }, now, now), [])
})
test('missing CLI fails cleanly and offline mode retains source attribution', async () => {
  await assert.rejects(readRateLimits('/missing/sprout-codex-binary', undefined, 500), /找不到/)
  const quota = await getQuota({ codexHome: '/missing', live: false }, { at: Date.now() - 600_000, value: { primary: { used_percent: 12, window_minutes: 300, resets_at: Date.now() / 1000 + 300 } } })
  assert.equal(quota.source, 'session')
  assert.equal(quota.windows[0].usedPercent, 12)
})
