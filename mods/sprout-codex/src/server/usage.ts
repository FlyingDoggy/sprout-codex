import { dayAt, zeroTokens, type Usage, type UsageDay } from '../model'
import { estimateCost, type Prices } from './pricing'
import { TOKEN_KEYS, type FileScan, type Receipt } from './usage-records'
export { consumeLine, freshScan, tokenUsage } from './usage-records'
export { scanUsage, readCachedUsage, emptyUsage } from './usage-store'
export type { Prices } from './pricing'

/** Price aggregated buckets: context band and service tier remain separate. */
export function summarize(events: Iterable<Receipt>, files: number, timezone: string, prices: Prices = {}): Usage {
  const days = new Map<string, UsageDay>(), unpriced = new Set<string>()
  const models = new Map<string, Usage['models'][number]>()
  const costAssumptions = { standardTierEvents: 0, shortContextEvents: 0, defaultCacheWriteEvents: 0 }
  for (const event of events) {
    const day = dayAt(event.timestamp, timezone)
    const row = days.get(day) ?? { day, ...zeroTokens(), costUsd: 0, knownCostUsd: 0, pricedTokens: 0 }
    for (const key of TOKEN_KEYS) row[key] += event.tokens[key]
    const model = models.get(event.model) ?? { model: event.model, tokens: 0, costUsd: 0, knownCostUsd: 0 }
    model.tokens += event.tokens.total
    const cost = estimateCost(event.tokens, event.model, prices, event.requestInput, event.serviceTier)
    if (cost === null) { unpriced.add(event.model); row.costUsd = null; model.costUsd = null }
    else {
      row.knownCostUsd += cost; row.pricedTokens += event.tokens.total; model.knownCostUsd += cost
      if (row.costUsd !== null) row.costUsd += cost
      if (model.costUsd !== null) model.costUsd += cost
      if (event.serviceTier === null) costAssumptions.standardTierEvents += event.count ?? 1
      if (event.requestInput === null) costAssumptions.shortContextEvents += event.count ?? 1
      if (event.tokens.cacheWrite > 0) costAssumptions.defaultCacheWriteEvents += event.count ?? 1
    }
    models.set(event.model, model); days.set(day, row)
  }
  const sorted = [...days.values()].sort((a, b) => a.day.localeCompare(b.day))
  const totals: Usage['totals'] = { ...zeroTokens(), costUsd: 0 }
  for (const day of sorted) {
    for (const key of TOKEN_KEYS) totals[key] += day[key]
    totals.costUsd = totals.costUsd === null || day.costUsd === null ? null : totals.costUsd + day.costUsd
  }
  return { days: sorted, totals, firstDay: sorted[0]?.day ?? null, files, unpricedModels: [...unpriced].sort(), models: [...models.values()].sort((a, b) => b.tokens - a.tokens), costAssumptions, warnings: [], lastQuota: null }
}

export function aggregate(scans: FileScan[], timezone: string, prices: Prices = {}): Usage {
  const receipts = new Map<string, Receipt>()
  for (const event of scans.flatMap(s => s.events)) {
    const previous = receipts.get(event.key)
    if (!previous || previous.model === 'unknown' && event.model !== 'unknown') receipts.set(event.key, event)
  }
  for (const alias of scans.flatMap(s => s.aliases)) if (receipts.has(alias.atomic)) receipts.delete(alias.legacy)
  const usage = summarize(receipts.values(), scans.length, timezone, prices)
  usage.lastQuota = scans.map(s => s.quota).filter((q): q is NonNullable<typeof q> => !!q).sort((a, b) => b.at - a.at)[0] ?? null
  return usage
}
