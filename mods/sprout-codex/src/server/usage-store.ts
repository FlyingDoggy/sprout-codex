import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile, rm, stat, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { type Usage, type Tokens } from '../model'
import { activityOf, type ActivityState } from './activity'
import { consumeLine, freshScan, type FileScan, type Receipt } from './usage-records'
import { rolloutLines, walkRollouts } from './rollout-files'
import { summarize } from './usage'
import type { Prices } from './pricing'

export type UsageSnapshot = Usage & { activity: ReturnType<typeof activityOf>; activityStates: ActivityState[]; loading?: boolean }
const databasePath = (dir: string) => join(dir, 'usage-v1.sqlite')
export const emptyUsage = (timezone: string): UsageSnapshot => ({ ...summarize([], 0, timezone), activity: activityOf([]), activityStates: [], loading: true })
export async function readCachedUsage(dataDir: string, timezone: string): Promise<UsageSnapshot> {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(databasePath(dataDir), { readOnly: true, timeout: 0 })
    const saved = db.prepare("SELECT value FROM meta WHERE key='summary'").get() as { value: string } | undefined
    return saved ? JSON.parse(saved.value) : emptyUsage(timezone)
  } catch { return emptyUsage(timezone) } finally { db?.close() }
}

function schema(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, source TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY, ts REAL NOT NULL, model TEXT NOT NULL, tier TEXT,
      context INTEGER, input REAL, cached REAL, cacheWrite REAL, output REAL, reasoning REAL, total REAL);
    CREATE TABLE IF NOT EXISTS members(file TEXT, receipt TEXT, PRIMARY KEY(file,receipt));
    CREATE INDEX IF NOT EXISTS members_receipt ON members(receipt);
    CREATE TABLE IF NOT EXISTS aliases(legacy TEXT, atomic TEXT, PRIMARY KEY(legacy,atomic));
    CREATE TABLE IF NOT EXISTS checkpoints(file TEXT, thread TEXT, ts REAL, ordinal INTEGER, total TEXT,
      PRIMARY KEY(file,thread,ts,ordinal));
    CREATE INDEX IF NOT EXISTS checkpoints_thread ON checkpoints(thread,ts);
  `)
}

/** One writer across MCP processes, without blocking another panel on a history import. */
async function acquire(dataDir: string) {
  const path = join(dataDir, 'usage-scan.lock')
  try { await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 }); return path }
  catch (error: any) { if (error.code !== 'EEXIST') throw error }
  let pid: number
  try { pid = Number(await readFile(path, 'utf8')) } catch { return null }
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try { process.kill(pid, 0); return null } catch (error: any) { if (error.code !== 'ESRCH') return null }
  await rm(path, { force: true })
  try { await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 }); return path } catch { return null }
}

export async function scanUsage(codexHome: string, dataDir: string, timezone: string, prices: Prices = {}): Promise<UsageSnapshot> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lock = await acquire(dataDir)
  if (!lock) return readCachedUsage(dataDir, timezone)
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(databasePath(dataDir), { timeout: 0 }); schema(db)
    await chmod(databasePath(dataDir), 0o600)
    const saved = new Map((db.prepare('SELECT * FROM files').all() as { path: string; source: string; state: string }[]).map(row => [row.path, { source: row.source, scan: JSON.parse(row.state) as FileScan }]))
    const paths = new Map<string, string>(), warnings = new Set<string>()
    let completeListing = true, changed = !!db.prepare("SELECT 1 FROM meta WHERE key='dirty'").get()
    for (const root of ['sessions', 'archived_sessions']) {
      try {
        for await (const source of walkRollouts(join(codexHome, root))) {
          const key = source.replace(/\.zst$/, '')
          if (!paths.has(key) || !source.endsWith('.zst')) paths.set(key, source)
        }
      } catch { completeListing = false; warnings.add('有会话目录无法读取，保留上次统计。') }
    }
    const headers = new Map<string, { thread: string; fork: string }>()
    // Process a child after its parent, including parents in archived_sessions.
    for (const [key, source] of paths) {
      const cached = saved.get(key)
      if (cached) { headers.set(key, cached.scan); continue }
      try {
        for await (const { line } of rolloutLines(source)) {
          const first = freshScan(); consumeLine(first, line)
          headers.set(key, first); break
        }
      } catch { /* full scan below reports the read error */ }
    }
    const byThread = new Map([...headers].map(([key, value]) => [value.thread, key]))
    const ordered: string[] = [], visiting = new Set<string>()
    function visit(key: string) {
      if (visiting.has(key)) return
      visiting.add(key)
      const parent = byThread.get(headers.get(key)?.fork ?? '')
      if (parent && parent !== key) visit(parent)
      ordered.push(key)
    }
    for (const key of [...paths.keys()].sort()) visit(key)
    const insert = db.prepare(`INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      model=CASE WHEN receipts.model='unknown' THEN excluded.model ELSE receipts.model END,
      tier=COALESCE(receipts.tier,excluded.tier), context=COALESCE(receipts.context,excluded.context)`)
    const member = db.prepare('INSERT OR IGNORE INTO members VALUES(?,?)')
    const alias = db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?)')
    const checkpoint = db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?,?)')
    const parentAt = db.prepare('SELECT total FROM checkpoints WHERE thread=? AND ts<=? ORDER BY ts DESC LIMIT 1')
    const parentOrdinal = db.prepare('SELECT total FROM checkpoints WHERE thread=? AND ordinal>=0 AND ordinal<? ORDER BY ordinal DESC LIMIT 1')
    const forget = (key: string) => {
      db!.prepare('DELETE FROM members WHERE file=?').run(key)
      db!.prepare('DELETE FROM checkpoints WHERE file=?').run(key)
      db!.prepare('DELETE FROM files WHERE path=?').run(key)
    }
    for (const key of ordered) {
      const source = paths.get(key)!
      try {
        const info = await stat(source), old = saved.get(key)
        const resolvedParent = old?.scan.incompleteFork && (old.scan.forkOrdinal === null
          ? parentAt.get(old.scan.fork, old.scan.forkAt) : parentOrdinal.get(old.scan.fork, old.scan.forkOrdinal))
        const reusable = old && old.scan.version === 2 && !resolvedParent
        if (reusable && old.source === source && old.scan.size === info.size && old.scan.mtime === info.mtimeMs) continue
        const incremental = reusable && old.source === source && !source.endsWith('.zst') && info.size > old.scan.size && info.mtimeMs >= old.scan.mtime
        const scan = incremental ? old.scan : freshScan()
        scan.events = []; scan.aliases = []; scan.checkpoints = []
        const flush = () => {
          for (const e of scan.events) {
            const t = e.tokens
            insert.run(e.key, e.timestamp, e.model, e.serviceTier, e.requestInput === null ? null : e.requestInput > 272_000 ? 1 : 0, t.input, t.cached, t.cacheWrite, t.output, t.reasoning, t.total)
            member.run(key, e.key)
          }
          for (const a of scan.aliases) alias.run(a.legacy, a.atomic)
          for (const c of scan.checkpoints) checkpoint.run(key, c.thread, c.timestamp, c.ordinal ?? -1, JSON.stringify(c.total))
          scan.events = []; scan.aliases = []; scan.checkpoints = []
        }
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('dirty', '1')
          if (!incremental) forget(key)
          if (info.size > scan.offset || source.endsWith('.zst')) for await (const { line, offset } of rolloutLines(source, scan.offset, source.endsWith('.zst') ? undefined : info.size - 1)) {
            consumeLine(scan, line, {
              parent: (thread, at, ordinal) => {
                const row = (ordinal === null ? parentAt.get(thread, at) : parentOrdinal.get(thread, ordinal)) as { total: string } | undefined
                return row ? JSON.parse(row.total) as Tokens : null
              },
            })
            scan.offset = offset
            if (scan.events.length + scan.checkpoints.length > 512) flush()
          }
          flush(); scan.size = info.size; scan.mtime = info.mtimeMs
          db.prepare('INSERT OR REPLACE INTO files VALUES(?,?,?)').run(key, source, JSON.stringify(scan))
          db.exec('COMMIT'); changed = true
        } catch (error) { db.exec('ROLLBACK'); throw error }
      } catch { warnings.add('有会话记录暂时无法读取，保留上次统计。') }
    }
    if (completeListing) for (const key of saved.keys()) if (!paths.has(key)) {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('dirty', '1')
      forget(key); changed = true
      db.exec('COMMIT')
    }
    if (changed) db.exec('DELETE FROM receipts WHERE NOT EXISTS(SELECT 1 FROM members WHERE receipt=receipts.key)')
    const states = (db.prepare('SELECT state FROM files').all() as { state: string }[]).map(row => JSON.parse(row.state) as FileScan)
    if (states.some(state => state.incompleteFork)) warnings.add('部分旧分叉缺少父会话基线，仅计入可确认的新增用量。')
    const signature = createHash('sha256').update(JSON.stringify([timezone, prices])).digest('hex')
    const oldSignature = (db.prepare("SELECT value FROM meta WHERE key='pricing'").get() as { value: string } | undefined)?.value
    const oldSummary = (db.prepare("SELECT value FROM meta WHERE key='summary'").get() as { value: string } | undefined)?.value
    let result: UsageSnapshot
    if (!changed && oldSummary && oldSignature === signature) result = JSON.parse(oldSummary)
    else {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      db.function('usage_day', { deterministic: true }, (at: any) => formatter.format(Number(at)))
      const buckets = db.prepare(`SELECT MIN(ts) AS ts, model, tier, context, SUM(input) AS input, SUM(cached) AS cached,
        SUM(cacheWrite) AS cacheWrite, SUM(output) AS output, SUM(reasoning) AS reasoning, SUM(total) AS total, COUNT(*) AS n
        FROM receipts r WHERE NOT EXISTS(SELECT 1 FROM aliases a JOIN receipts ar ON ar.key=a.atomic WHERE a.legacy=r.key)
        GROUP BY usage_day(ts),model,tier,context,(cacheWrite>0)`).all() as any[]
      const events: Receipt[] = buckets.map(r => ({ key: '', timestamp: r.ts, model: r.model, serviceTier: r.tier, requestInput: r.context === null ? null : r.context ? 272_001 : 0, count: r.n, tokens: { input: r.input, cached: r.cached, cacheWrite: r.cacheWrite, output: r.output, reasoning: r.reasoning, total: r.total } }))
      const activityStates = states.map(s => s.activity)
      result = { ...summarize(events, states.length, timezone, prices), activity: activityOf(activityStates), activityStates, loading: false }
      result.lastQuota = states.map(s => s.quota).filter((q): q is NonNullable<typeof q> => !!q).sort((a, b) => b.at - a.at)[0] ?? null
    }
    result.warnings = [...warnings]
    const next = JSON.stringify(result)
    if (changed || next !== oldSummary || oldSignature !== signature) {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('summary', next)
      db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('pricing', signature)
      db.exec("DELETE FROM meta WHERE key='dirty'")
      db.exec('COMMIT')
    }
    return result
  } finally { db?.close(); await rm(lock, { force: true }) }
}
