import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dayAt, zeroTokens, type Tokens, type Usage, type UsageDay } from '../model'
import { readJson, writeJson } from './storage'
import { estimateCost, type Prices } from './pricing'
import { activityOf, consumeActivity, freshActivity, type ActivityState } from './activity'

export type { Prices } from './pricing'
type Event = { key: string; timestamp: number; model: string; tokens: Tokens; requestInput: number | null; serviceTier: string | null }
type FileScan = {
  size: number; mtime: number; offset: number; model: string; serviceTier: string | null; previous: Tokens;
  events: Event[]; quota: Usage['lastQuota']; activity: ActivityState;
}
type Cache = { version: 6; files: Record<string, FileScan> }
const KEYS = ['input', 'cached', 'cacheWrite', 'output', 'reasoning', 'total'] as const
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

export function tokenUsage(raw: any): Tokens | null {
  if (!raw || typeof raw !== 'object') return null
  const input = finite(raw.input_tokens)
  const output = finite(raw.output_tokens)
  const cached = Math.min(input, finite(raw.cached_input_tokens))
  return { input, output, cached, cacheWrite: Math.min(input - cached, finite(raw.cache_write_input_tokens)), reasoning: Math.min(output, finite(raw.reasoning_output_tokens)), total: input + output }
}

export function consumeLine(scan: FileScan, line: string) {
  if (!/token_count|turn_context|session_meta|task_started|task_complete|turn_aborted|item_completed|compacted|user_message|"role"\s*:\s*"user"/.test(line)) return
  let record: any
  try { record = JSON.parse(line) } catch { return }
  consumeActivity(scan.activity, record)
  const payload = record.payload
  if (record.type === 'turn_context') {
    if (typeof payload?.model === 'string') scan.model = payload.model
    scan.serviceTier = typeof payload?.service_tier === 'string' ? payload.service_tier : null
  }
  if (record.type !== 'event_msg' || payload?.type !== 'token_count') return
  const timestamp = Date.parse(record.timestamp)
  if (!Number.isFinite(timestamp)) return
  if (payload.rate_limits) scan.quota = { at: timestamp, value: payload.rate_limits }
  const total = tokenUsage(payload.info?.total_token_usage)
  if (!total || total.total <= scan.previous.total) return
  const tokens = zeroTokens()
  for (const key of KEYS) tokens[key] = Math.max(0, total[key] - scan.previous[key])
  tokens.total = tokens.input + tokens.output
  tokens.cached = Math.min(tokens.input, tokens.cached)
  tokens.cacheWrite = Math.min(tokens.input - tokens.cached, tokens.cacheWrite)
  tokens.reasoning = Math.min(tokens.output, tokens.reasoning)
  // Copied fork histories retain the timestamp and counters of the original event.
  const key = createHash('sha256').update(JSON.stringify([timestamp, total])).digest('hex')
  const last = tokenUsage(payload.info?.last_token_usage)
  // A cumulative jump can cover several requests. Do not treat it as one long prompt.
  const requestInput = last && last.input > 0 && last.input === tokens.input ? last.input : null
  scan.events.push({ key, timestamp, model: scan.model, tokens, requestInput, serviceTier: scan.serviceTier })
  scan.previous = total
}

export const freshScan = (): FileScan => ({ size: 0, mtime: 0, offset: 0, model: 'unknown', serviceTier: null, previous: zeroTokens(), events: [], quota: null, activity: freshActivity() })

async function* walk(root: string): AsyncGenerator<string> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error: any) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const item of entries) {
    const path = join(root, item.name)
    if (item.isDirectory()) yield* walk(path)
    else if (item.isFile() && item.name.endsWith('.jsonl')) yield path
  }
}

async function scanFile(path: string, previous?: FileScan): Promise<FileScan> {
  const info = await stat(path)
  if (previous && info.size === previous.size && info.mtimeMs === previous.mtime) return previous
  const scan = previous && info.size > previous.size && info.mtimeMs >= previous.mtime ? previous : freshScan()
  let tail = Buffer.alloc(0)
  let offset = scan.offset
  if (offset < info.size) {
    for await (const raw of createReadStream(path, { start: offset, end: info.size - 1 })) {
      const chunk = Buffer.concat([tail, raw as Buffer])
      let start = 0
      let end: number
      while ((end = chunk.indexOf(10, start)) !== -1) {
        consumeLine(scan, chunk.subarray(start, end).toString('utf8'))
        offset += end - start + 1
        start = end + 1
      }
      tail = chunk.subarray(start)
    }
  }
  scan.offset = offset
  scan.size = info.size
  scan.mtime = info.mtimeMs
  return scan
}

export function aggregate(scans: FileScan[], timezone: string, prices: Prices = {}): Usage {
  const days = new Map<string, UsageDay>()
  const seen = new Set<string>()
  const unpriced = new Set<string>()
  const models = new Map<string, Usage['models'][number]>()
  const costAssumptions = { standardTierEvents: 0, shortContextEvents: 0, defaultCacheWriteEvents: 0 }
  let lastQuota: Usage['lastQuota'] = null
  for (const file of scans) {
    if (file.quota && (!lastQuota || file.quota.at > lastQuota.at)) lastQuota = file.quota
    for (const event of file.events) {
      if (seen.has(event.key)) continue
      seen.add(event.key)
      const day = dayAt(event.timestamp, timezone)
      const row = days.get(day) ?? { day, ...zeroTokens(), costUsd: 0, knownCostUsd: 0, pricedTokens: 0 }
      for (const key of KEYS) row[key] += event.tokens[key]
      const model = models.get(event.model) ?? { model: event.model, tokens: 0, costUsd: 0, knownCostUsd: 0 }
      model.tokens += event.tokens.total
      const cost = estimateCost(event.tokens, event.model, prices, event.requestInput, event.serviceTier)
      if (cost === null) {
        unpriced.add(event.model)
        row.costUsd = null
        model.costUsd = null
      } else {
        row.knownCostUsd += cost
        row.pricedTokens += event.tokens.total
        model.knownCostUsd += cost
        if (row.costUsd !== null) row.costUsd += cost
        if (model.costUsd !== null) model.costUsd += cost
        if (event.serviceTier === null) costAssumptions.standardTierEvents++
        if (event.requestInput === null) costAssumptions.shortContextEvents++
        if (event.tokens.cacheWrite > 0) costAssumptions.defaultCacheWriteEvents++
      }
      models.set(event.model, model)
      days.set(day, row)
    }
  }
  const sorted = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  const totals: Usage['totals'] = { ...zeroTokens(), costUsd: 0 }
  for (const day of sorted) {
    for (const key of KEYS) totals[key] += day[key]
    totals.costUsd = totals.costUsd === null || day.costUsd === null ? null : totals.costUsd + day.costUsd
  }
  return { days: sorted, totals, firstDay: sorted[0]?.day ?? null, files: scans.length, unpricedModels: [...unpriced].sort(), models: [...models.values()].sort((a, b) => b.tokens - a.tokens), costAssumptions, warnings: [], lastQuota }
}

export async function scanUsage(codexHome: string, dataDir: string, timezone: string, prices: Prices = {}) {
  const cachePath = join(dataDir, 'usage-cache.json')
  const old = await readJson<Cache>(cachePath, { version: 6, files: {} })
  const next: Cache = { version: 6, files: {} }
  const warnings: string[] = []
  for (const root of ['sessions', 'archived_sessions']) {
    try {
      for await (const file of walk(join(codexHome, root))) {
        try { next.files[file] = await scanFile(file, old.version === 6 ? old.files[file] : undefined) }
        catch { warnings.push('有会话记录暂时无法读取，统计可能不完整。') }
      }
    } catch { warnings.push('有会话目录无法读取，请检查本机文件权限。') }
  }
  await writeJson(cachePath, next)
  const usage = aggregate(Object.values(next.files), timezone, prices)
  usage.warnings = [...new Set(warnings)]
  const activityStates = Object.values(next.files).map(file => file.activity)
  return { ...usage, activity: activityOf(activityStates), activityStates }
}
