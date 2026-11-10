import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dayAt, zeroTokens, type Tokens, type Usage, type UsageDay } from '../model'
import { readJson, writeJson } from './storage'

export type Prices = Record<string, { input: number; cached: number; output: number }>
type Event = { key: string; timestamp: number; model: string; tokens: Tokens }
type FileScan = {
  size: number; mtime: number; offset: number; model: string; previous: Tokens;
  events: Event[]; quota: Usage['lastQuota'];
}
type Cache = { version: 1; files: Record<string, FileScan> }
const KEYS = ['input', 'cached', 'output', 'reasoning', 'total'] as const
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

export function tokenUsage(raw: any): Tokens | null {
  if (!raw || typeof raw !== 'object') return null
  const input = finite(raw.input_tokens)
  const output = finite(raw.output_tokens)
  return { input, output, cached: Math.min(input, finite(raw.cached_input_tokens)), reasoning: Math.min(output, finite(raw.reasoning_output_tokens)), total: input + output }
}

export function consumeLine(scan: FileScan, line: string) {
  if (!line.includes('token_count') && !line.includes('turn_context')) return
  let record: any
  try { record = JSON.parse(line) } catch { return }
  const payload = record.payload
  if (record.type === 'turn_context' && typeof payload?.model === 'string') scan.model = payload.model
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
  tokens.reasoning = Math.min(tokens.output, tokens.reasoning)
  // Copied fork histories retain the timestamp and counters of the original event.
  const key = createHash('sha256').update(JSON.stringify([timestamp, total])).digest('hex')
  scan.events.push({ key, timestamp, model: scan.model, tokens })
  scan.previous = total
}

export const freshScan = (): FileScan => ({ size: 0, mtime: 0, offset: 0, model: 'unknown', previous: zeroTokens(), events: [], quota: null })

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
  let lastQuota: Usage['lastQuota'] = null
  for (const file of scans) {
    if (file.quota && (!lastQuota || file.quota.at > lastQuota.at)) lastQuota = file.quota
    for (const event of file.events) {
      if (seen.has(event.key)) continue
      seen.add(event.key)
      const day = dayAt(event.timestamp, timezone)
      const row = days.get(day) ?? { day, ...zeroTokens(), costUsd: 0 }
      for (const key of KEYS) row[key] += event.tokens[key]
      const price = prices[event.model]
      if (!price || ![price.input, price.output, price.cached].every(n => Number.isFinite(n) && n >= 0)) {
        unpriced.add(event.model)
        row.costUsd = null
      } else if (row.costUsd !== null) {
        const usage = event.tokens
        row.costUsd += ((usage.input - usage.cached) * price.input + usage.cached * price.cached + usage.output * price.output) / 1e6
      }
      days.set(day, row)
    }
  }
  const sorted = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  const totals: Usage['totals'] = { ...zeroTokens(), costUsd: 0 }
  for (const day of sorted) {
    for (const key of KEYS) totals[key] += day[key]
    totals.costUsd = totals.costUsd === null || day.costUsd === null ? null : totals.costUsd + day.costUsd
  }
  return { days: sorted, totals, firstDay: sorted[0]?.day ?? null, files: scans.length, unpricedModels: [...unpriced].sort(), warnings: [], lastQuota }
}

export async function scanUsage(codexHome: string, dataDir: string, timezone: string, prices: Prices = {}): Promise<Usage> {
  const cachePath = join(dataDir, 'usage-cache.json')
  const old = await readJson<Cache>(cachePath, { version: 1, files: {} })
  const next: Cache = { version: 1, files: {} }
  const warnings: string[] = []
  for (const root of ['sessions', 'archived_sessions']) {
    try {
      for await (const file of walk(join(codexHome, root))) {
        try { next.files[file] = await scanFile(file, old.version === 1 ? old.files[file] : undefined) }
        catch { warnings.push('有会话记录暂时无法读取，统计可能不完整。') }
      }
    } catch { warnings.push('有会话目录无法读取，请检查本机文件权限。') }
  }
  await writeJson(cachePath, next)
  const usage = aggregate(Object.values(next.files), timezone, prices)
  usage.warnings = [...new Set(warnings)]
  return usage
}
