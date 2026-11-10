import { join } from 'node:path'
import bundled from '../data/openai-prices.json'
import type { Tokens } from '../model'
import { readJson, writeJson } from './storage'

export const PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
export const PRICING_DATA_URL = `${PRICING_URL}.md`
export type Tier = 'standard' | 'fast' | 'batch' | 'flex' | 'ultrafast'
export type Rate = { input: number; cached: number | null; output: number; write?: number | null; write12h?: number | null }
export type ContextRate = Rate & { long?: Rate }
export type ModelPrice = ContextRate & { tiers?: Partial<Record<Tier, ContextRate>> }
export type Prices = Record<string, ModelPrice>
export type Catalog = { version: 1; sourceUrl: string; fetchedAt: number; models: Prices }
export type PricingInfo = { sourceUrl: string; checkedAt: number; source: 'official' | 'cached' | 'bundled'; warning: string | null; customModels: string[] }

const validRate = (rate: any): rate is Rate => !!rate &&
  ['input', 'output'].every(key => typeof rate[key] === 'number' && Number.isFinite(rate[key]) && rate[key] >= 0) &&
  ['cached', 'write', 'write12h'].every(key => rate[key] == null || typeof rate[key] === 'number' && Number.isFinite(rate[key]) && rate[key] >= 0)
function validCatalog(value: any): value is Catalog {
  return value?.version === 1 && value.sourceUrl === PRICING_URL && Number.isFinite(value.fetchedAt) &&
    value.models && Object.keys(value.models).length > 0 && Object.values(value.models).every((price: any) =>
      (!price.long || validRate(price.long)) && Object.values(price.tiers ?? {}).every((rate: any) => (!rate.long || validRate(rate.long)) && validRate(rate)) && validRate(price))
}

/** Read named tables, never guess column positions or silently apply another service tier. */
export function parseOfficialPrices(markdown: string, now = Date.now()): Catalog {
  const models: Prices = {}
  let tier: Tier | null = null
  let columns: string[] = []
  const amount = (raw: string | undefined) => {
    if (raw === '-') return null
    if (!raw || !/^\$\d+(?:\.\d+)?$/.test(raw)) throw new Error('官方价格表的数值格式发生变化。')
    return Number(raw.slice(1))
  }
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{3,4} (.+)$/)?.[1]
    if (heading) {
      const name = heading.replace(' pricing data', '').toLowerCase()
      tier = ['standard', 'fast', 'batch', 'flex', 'ultrafast'].includes(name) ? name as Tier : null
      columns = []
    }
    if (!tier || !line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells[0] === 'Model') { columns = cells.map(cell => cell.toLowerCase()); continue }
    const model = cells[0].replace(/ \(<272K context length\)$/, '')
    if (!/^(gpt-[a-z0-9.-]+|o\d[a-z0-9.-]*)$/.test(model)) continue
    const read = (prefix: string): Rate => {
      const at = (name: string) => cells[columns.indexOf(prefix + name)]
      const rate = { input: amount(at('input')), output: amount(at('output')), cached: amount(at('cached input')),
        ...(columns.includes(prefix + '30m write') ? { write: amount(at('30m write')), write12h: amount(at('12h write')) } : {}) }
      if (!validRate(rate)) throw new Error(`官方价格缺少 ${model} 的必需字段。`)
      return rate
    }
    const rate: ContextRate = read(columns.includes('short context input') ? 'short context ' : '')
    if (columns.includes('long context input') && cells[columns.indexOf('long context input')] !== '-') rate.long = read('long context ')
    if (tier === 'standard') models[model] = rate
    else if (models[model]) (models[model].tiers ??= {})[tier] = rate
  }
  if (Object.keys(models).length < 3) throw new Error('官方价格表未包含可识别的模型。')
  return { version: 1, sourceUrl: PRICING_URL, fetchedAt: now, models }
}

export async function fetchOfficialPrices(fetcher: typeof fetch = fetch): Promise<Catalog> {
  const response = await fetcher(PRICING_DATA_URL, { signal: AbortSignal.timeout(6000), headers: { Accept: 'text/markdown' } })
  if (!response.ok) throw new Error(`官方价格请求失败（${response.status}）。`)
  const text = await response.text()
  if (text.length > 2_000_000) throw new Error('官方价格响应过大。')
  return parseOfficialPrices(text)
}

export async function loadPrices(dataDir: string, online: boolean, overrides: Prices, fetcher: typeof fetch = fetch): Promise<{ prices: Prices; info: PricingInfo }> {
  const saved = await readJson<Catalog | null>(join(dataDir, 'openai-prices.json'), null)
  let catalog: Catalog = validCatalog(saved) && saved.fetchedAt >= bundled.fetchedAt ? saved : bundled as Catalog
  let source: PricingInfo['source'] = catalog === saved ? 'cached' : 'bundled'
  let warning: string | null = null
  if (online && Date.now() - catalog.fetchedAt > 86_400_000) {
    try {
      catalog = await fetchOfficialPrices(fetcher)
      await writeJson(join(dataDir, 'openai-prices.json'), catalog)
      source = 'official'
    } catch { warning = '官网价格暂时无法更新，正在使用上次核验的单价。' }
  }
  const customModels = Object.keys(overrides)
  return { prices: { ...catalog.models, ...overrides }, info: { sourceUrl: PRICING_URL, checkedAt: catalog.fetchedAt, source, warning, customModels } }
}

export function estimateCost(tokens: Tokens, model: string, prices: Prices, requestInput: number | null, serviceTier: string | null) {
  // Only documented dated snapshots inherit a base model price; arbitrary prefixes never do.
  const base = prices[model] ?? prices[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')]
  const tier = serviceTier === 'priority' ? 'fast' : serviceTier === 'default' ? 'standard' : serviceTier ?? 'standard'
  const price = tier === 'standard' ? base : base?.tiers?.[tier as Tier]
  if (!price) return null
  if (requestInput !== null && requestInput > 272_000 && base.long && !price.long) return null
  const rate = requestInput !== null && requestInput > 272_000 && price.long ? price.long : price
  if (!validRate(rate)) return null
  if (tokens.cached && rate.cached == null || tokens.cacheWrite && rate.write == null) return null
  return ((tokens.input - tokens.cached - tokens.cacheWrite) * rate.input + tokens.cached * (rate.cached ?? 0) +
    tokens.cacheWrite * (rate.write ?? 0) + tokens.output * rate.output) / 1e6
}
