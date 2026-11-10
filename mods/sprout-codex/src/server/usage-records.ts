import { createHash } from 'node:crypto'
import { zeroTokens, type Tokens, type Usage } from '../model'
import { consumeActivity, freshActivity, type ActivityState } from './activity'

export const TOKEN_KEYS = ['input', 'cached', 'cacheWrite', 'output', 'reasoning', 'total'] as const
export type Receipt = { key: string; timestamp: number; model: string; tokens: Tokens; requestInput: number | null; serviceTier: string | null; count?: number }
type Lane = { previous: Tokens; at: number; initialized: boolean; epoch: number;
  atomicMode?: boolean;
  base: Tokens | null; replaying: boolean;
  legacy?: { key: string; tokens: Tokens; total: Tokens; at: number } }
export type Checkpoint = { thread: string; timestamp: number; ordinal: number | null; total: Tokens }
export type FileScan = {
  version: 2; size: number; mtime: number; offset: number; model: string; serviceTier: string | null;
  owner: string; thread: string; fork: string; forkAt: number; forkOrdinal: number | null;
  lanes: Record<string, Lane>; settings: Record<string, { model: string; serviceTier: string | null }>;
  events: Receipt[]; aliases: { legacy: string; atomic: string }[]; checkpoints: Checkpoint[];
  quota: Usage['lastQuota']; activity: ActivityState; incompleteFork: boolean;
}
type Resolver = { parent?: (thread: string, at: number, ordinal: number | null) => Tokens | null }
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
export function tokenUsage(raw: any): Tokens | null {
  if (!raw || typeof raw !== 'object') return null
  const input = finite(raw.input_tokens), output = finite(raw.output_tokens), cached = Math.min(input, finite(raw.cached_input_tokens))
  return { input, output, cached, cacheWrite: Math.min(input - cached, finite(raw.cache_write_input_tokens)), reasoning: Math.min(output, finite(raw.reasoning_output_tokens)), total: input + output }
}
const equal = (a: Tokens, b: Tokens) => TOKEN_KEYS.every(key => a[key] === b[key])
const add = (a: Tokens, b: Tokens): Tokens => Object.fromEntries(TOKEN_KEYS.map(k => [k, a[k] + b[k]])) as Tokens
const subtract = (a: Tokens, b: Tokens): Tokens => Object.fromEntries(TOKEN_KEYS.map(k => [k, Math.max(0, a[k] - b[k])])) as Tokens
export const freshScan = (): FileScan => ({ version: 2, size: 0, mtime: 0, offset: 0, model: 'unknown', serviceTier: null, owner: '', thread: '', fork: '', forkAt: 0, forkOrdinal: null, lanes: {}, settings: {}, events: [], aliases: [], checkpoints: [], quota: null, activity: freshActivity(), incompleteFork: false })

/** Native rollout metadata only. Prompts/outputs never enter the usage ledger. */
export function consumeLine(scan: FileScan, line: string, resolve: Resolver = {}) {
  if (!/token_count|token_usage_record|thread_settings_applied|turn_context|session_meta|task_started|task_complete|turn_aborted|item_completed|compacted|user_message|"role"\s*:\s*"user"/.test(line.slice(0, 2048))) return
  let record: any
  try { record = JSON.parse(line) } catch { return }
  consumeActivity(scan.activity, record)
  const p = record.payload, timestamp = Date.parse(record.timestamp)
  if (!p || typeof p !== 'object') return
  if (record.type === 'session_meta') {
    scan.thread = typeof p.id === 'string' ? p.id : ''
    scan.owner = scan.thread
    scan.fork = typeof p.forked_from_id === 'string' ? p.forked_from_id : ''
    scan.forkAt = Date.parse(p.timestamp ?? record.timestamp) || 0
    scan.forkOrdinal = Number.isSafeInteger(p.forked_from_ordinal_exclusive) ? p.forked_from_ordinal_exclusive : null
    return
  }
  if (record.type === 'event_msg' && p.type === 'thread_settings_applied') {
    scan.owner = typeof p.thread_id === 'string' ? p.thread_id : scan.thread
    const settings = p.thread_settings
    if (!settings || typeof settings !== 'object') return
    if (typeof settings.model === 'string') scan.model = settings.model
    // This is a full snapshot. An omitted tier clears a previous priority setting.
    scan.serviceTier = typeof settings.service_tier === 'string' ? settings.service_tier : null
    scan.settings[scan.owner] = { model: scan.model, serviceTier: scan.serviceTier }
    return
  }
  if (record.type === 'turn_context') {
    if (typeof p.model === 'string') scan.model = p.model
    // Older clients may include a tier here; absence is NOT a tier change.
    if ('service_tier' in p) scan.serviceTier = typeof p.service_tier === 'string' ? p.service_tier : null
    scan.settings[scan.owner] = { model: scan.model, serviceTier: scan.serviceTier }
    return
  }
  if (!Number.isFinite(timestamp)) return
  const atomic = record.type === 'token_usage_record'
  if (!atomic && (record.type !== 'event_msg' || p.type !== 'token_count')) return
  if (!atomic && p.rate_limits && (!scan.quota || timestamp >= scan.quota.at)) scan.quota = { at: timestamp, value: p.rate_limits }
  const owner = atomic && typeof p.thread_id === 'string' ? p.thread_id : scan.owner
  // token_count is a physical history counter, including inherited fork history.
  // token_usage_record.thread_token_usage is an OWN-thread counter. Never use it
  // as the baseline for a physical snapshot.
  const lane = scan.lanes.physical ??= { previous: zeroTokens(), at: 0, initialized: false, epoch: 0, base: null, replaying: !!scan.fork }
  const settings = scan.settings[owner] ?? (owner === scan.owner || !scan.owner
    ? { model: scan.model, serviceTier: scan.serviceTier } : { model: 'unknown', serviceTier: null })
  const total = tokenUsage(atomic ? p.thread_token_usage : p.info?.total_token_usage)
  const emit = (key: string, tokens: Tokens, requestInput: number | null) => scan.events.push({ key, timestamp, tokens, requestInput, ...settings })
  if (atomic) {
    const tokens = tokenUsage(p.usage)
    if (!tokens || typeof p.response_id !== 'string' || !p.response_id) return
    const key = `response:${p.response_id}`
    emit(key, tokens, tokens.input)
    // A receipt can arrive after its snapshot, including across incremental reads.
    const legacy = lane.legacy
    if (legacy && total && (equal(legacy.total, total) || lane.base && equal(legacy.total, add(lane.base, total))) && equal(legacy.tokens, tokens) && Math.abs(timestamp - legacy.at) < 60_000) {
      scan.aliases.push({ legacy: legacy.key, atomic: key })
      lane.legacy = undefined
    }
    if (!scan.thread || owner === scan.thread) lane.atomicMode = true
    return
  }
  if (!total || timestamp < lane.at) return
  if (lane.atomicMode) {
    // Native response receipts are authoritative once available. Physical totals
    // may replay, inherit or replace history without representing another request.
    // Keep old-format prefixes, but never add mirrored snapshots to native receipts.
    lane.previous = total; lane.at = timestamp; lane.initialized = true
    scan.checkpoints.push({ thread: owner, timestamp, ordinal: Number.isSafeInteger(record.ordinal) ? record.ordinal : null, total })
    return
  }
  // A legacy fork may start with inherited counters but no copied records.
  // Seed from the parent's actual fork boundary, never charge that prefix again.
  if (!lane.initialized && scan.fork && timestamp >= scan.forkAt) {
    const inherited = resolve.parent?.(scan.fork, scan.forkAt, scan.forkOrdinal)
    if (inherited) { lane.previous = inherited; lane.base = inherited }
    else { lane.previous = total; scan.incompleteFork = true }
  }
  const copied = !!scan.fork && ((owner !== scan.thread) || lane.replaying && lane.base !== null && total.total <= lane.base.total)
  if (copied) {
    lane.at = timestamp; lane.initialized = true
    // Replayed records can have new timestamps. They are not fresh spending.
    // Keep the boundary, not the lower replayed counter, as the child's baseline.
    if (!lane.base) lane.previous = total
    return
  }
  lane.replaying = false
  const key = `snapshot:${createHash('sha256').update(JSON.stringify([scan.thread || timestamp, lane.epoch, total])).digest('hex')}`
  const reset = total.input < lane.previous.input || total.output < lane.previous.output
  const tokens = zeroTokens()
  if (!reset) {
    const delta = subtract(total, lane.previous)
    for (const k of TOKEN_KEYS) tokens[k] = delta[k]
    tokens.total = tokens.input + tokens.output
    tokens.cached = Math.min(tokens.input, tokens.cached)
    tokens.cacheWrite = Math.min(tokens.input - tokens.cached, tokens.cacheWrite)
    tokens.reasoning = Math.min(tokens.output, tokens.reasoning)
    if (tokens.total > 0) {
      const last = tokenUsage(p.info?.last_token_usage)
      emit(key, tokens, last && equal(last, tokens) ? last.input : null)
      lane.legacy = { key, tokens, total, at: timestamp }
    }
  } else { lane.epoch++; lane.legacy = undefined }
  // Even a zero/decreasing counter is a new baseline. Otherwise resumed work vanishes.
  lane.previous = total; lane.at = timestamp; lane.initialized = true
  scan.checkpoints.push({ thread: owner, timestamp, ordinal: Number.isSafeInteger(record.ordinal) ? record.ordinal : null, total })
}
