import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { aggregate, consumeLine, freshScan, scanUsage } from '../src/server/usage'

const at = Date.parse('2026-11-10T00:00:00Z')
const tokens = (input: number) => ({ input_tokens: input, output_tokens: 0, total_tokens: input })
const meta = (id: string, fork?: string, ordinal?: number) => ({ type: 'session_meta', timestamp: new Date(at+100).toISOString(), payload: { id, forked_from_id: fork, forked_from_ordinal_exclusive: ordinal } })
const snapshot = (input: number, ms: number, ordinal?: number) => ({ timestamp: new Date(at+ms).toISOString(), ordinal, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: tokens(input) } } })
const receipt = (id: string, input: number, total: number, ms: number, thread = 'parent') => ({ timestamp: new Date(at+ms).toISOString(), type: 'token_usage_record', payload: { thread_id: thread, response_id: id, usage: tokens(input), thread_token_usage: tokens(total) } })
const body = (...records: object[]) => records.map(r => JSON.stringify(r)).join('\n')+'\n'
const consume = (scan: ReturnType<typeof freshScan>, ...records: object[]) => records.forEach(r => consumeLine(scan, JSON.stringify(r)))

test('native settings survive turn_context; a subsequent full settings snapshot can clear the tier', () => {
  const s = freshScan()
  consume(s, { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'test', service_tier: 'priority' } } }, { type: 'turn_context', payload: { model: 'test' } }, snapshot(1000, 0))
  assert.equal(s.events[0].serviceTier, 'priority')
  assert.equal(aggregate([s], 'UTC', { test: { input: 1, cached: 0, output: 1, tiers: { fast: { input: 2, cached: 0, output: 2 } } } }).totals.costUsd, .002)
  consume(s, { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'test' } } }, snapshot(2000, 1))
  assert.equal(s.events[1].serviceTier, null)
})

test('counter resets establish a new baseline, including zero after compaction', () => {
  const s = freshScan()
  consume(s, snapshot(100, 0), snapshot(0, 1), snapshot(20, 2), snapshot(20, 3))
  assert.equal(aggregate([s], 'UTC').totals.total, 120)
})

test('native receipts remain authoritative when physical history counters jump or are replaced', () => {
  const s = freshScan()
  consume(s, meta('parent'), snapshot(100, 0), receipt('r1', 20, 120, 1), snapshot(5000, 2),
    receipt('r2', 30, 150, 3), snapshot(0, 4), snapshot(9000, 5))
  assert.equal(aggregate([s], 'UTC').totals.total, 150)
})

test('response receipts, matching snapshots and copied fork receipts count once; legacy prefixes remain', () => {
  const parent = freshScan(), child = freshScan()
  consume(parent, meta('parent'), snapshot(100, 0), receipt('r1', 20, 120, 1), snapshot(120, 2), receipt('r2', 30, 150, 3), snapshot(150, 4))
  consume(child, meta('child', 'parent'), receipt('r1', 20, 120, 1), receipt('r2', 30, 150, 3), receipt('r3', 40, 190, 101, 'child'), snapshot(190, 102))
  assert.equal(aggregate([parent, child], 'UTC').totals.total, 190)
})

test('an atomic receipt arriving after its snapshot replaces the estimate', () => {
  const s = freshScan()
  consume(s, meta('parent'), snapshot(100, 0), receipt('r1', 100, 100, 1), snapshot(100, 2))
  assert.equal(aggregate([s], 'UTC').totals.total, 100)
})

test('own-thread receipt counters are independent of physical inherited counters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-physical-'))
  try {
    await mkdir(join(root, 'sessions'))
    await writeFile(join(root, 'sessions/parent.jsonl'), body(meta('parent'), snapshot(100, 0)))
    const settings = (thread: string) => ({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: thread, thread_settings: { model: 'test', service_tier: 'priority' } } })
    await writeFile(join(root, 'sessions/child.jsonl'), body(meta('child', 'parent'),
      snapshot(100, 101), settings('parent'), snapshot(90, 102), snapshot(100, 103), settings('child'),
      receipt('c1', 20, 20, 110, 'child'), snapshot(120, 111), receipt('c2', 30, 50, 120, 'child'), snapshot(150, 121)))
    assert.equal((await scanUsage(root, join(root, 'state'), 'UTC')).totals.total, 150)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('compressed histories, fork ordinals, deduplication and incremental late receipts persist across scans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-ledger-')), state = join(root, 'state')
  try {
    await mkdir(join(root, 'sessions')); await mkdir(join(root, 'archived_sessions'))
    const p = join(root, 'archived_sessions/parent.jsonl'), c = join(root, 'sessions/child.jsonl')
    // Fork before ordinal 3, even though the parent continued before the child's metadata timestamp.
    const prefix = body(meta('parent'), { type: 'turn_context', payload: { model: 'test' } }, snapshot(100, 0, 2), snapshot(200, 50, 3))
    await writeFile(p+'.zst', zstdCompressSync(Buffer.from(prefix)))
    await writeFile(c, body(meta('child', 'parent', 3), snapshot(120, 101)))
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 220)
    // Both representations coexist during archival; prefer the uncompressed one.
    await writeFile(p, prefix)
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 220)
    await rm(p)
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 220)
    await appendFile(c, body(receipt('child-20', 20, 120, 102, 'child')))
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 220)
    const before = await stat(join(state, 'usage-v1.sqlite'))
    await scanUsage(root, state, 'UTC')
    const after = await stat(join(state, 'usage-v1.sqlite'))
    assert.equal(after.mtimeMs, before.mtimeMs, 'unchanged logs must not rewrite the ledger')
    // Repricing uses the ledger without changing file scan state.
    const db = new DatabaseSync(join(state, 'usage-v1.sqlite'), { readOnly: true })
    const files = db.prepare('SELECT state FROM files ORDER BY path').all(); db.close()
    const priced = await scanUsage(root, state, 'UTC', { test: { input: 2, cached: 0, output: 2 } })
    assert.equal(priced.models.find(m => m.model === 'test')?.costUsd, .0004)
    const db2 = new DatabaseSync(join(state, 'usage-v1.sqlite'), { readOnly: true })
    assert.deepEqual(db2.prepare('SELECT state FROM files ORDER BY path').all(), files); db2.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('unavailable legacy fork parents do not charge an inherited prefix as new work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-orphan-'))
  try {
    await mkdir(join(root, 'sessions'))
    await writeFile(join(root, 'sessions/child.jsonl'), body(meta('child', 'missing'), snapshot(100, 101), snapshot(120, 102)))
    const usage = await scanUsage(root, join(root, 'state'), 'UTC')
    assert.equal(usage.totals.total, 20)
    assert.equal(usage.warnings.length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an active writer serves its last complete summary; an unfinished aggregation is recovered', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sprout-recovery-')), state = join(root, 'state')
  try {
    await mkdir(join(root, 'sessions'))
    const file = join(root, 'sessions/a.jsonl')
    await writeFile(file, body(snapshot(100, 0)))
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 100)
    await writeFile(join(state, 'usage-scan.lock'), String(process.pid))
    await appendFile(file, body(snapshot(120, 1)))
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 100)
    await rm(join(state, 'usage-scan.lock'))
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 120)
    // Simulate a crash after committing a parsed file but before replacing the summary.
    const db = new DatabaseSync(join(state, 'usage-v1.sqlite'))
    db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('response:crash', at+2, 'test', null, 0, 10, 0, 0, 0, 0, 10)
    db.prepare('INSERT INTO members VALUES(?,?)').run(file, 'response:crash')
    db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('dirty', '1'); db.close()
    assert.equal((await scanUsage(root, state, 'UTC')).totals.total, 130)
  } finally { await rm(root, { recursive: true, force: true }) }
})
