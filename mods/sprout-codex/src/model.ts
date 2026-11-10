import type { PricingInfo } from './server/pricing'
export type Tokens = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number }
export type UsageDay = Tokens & { day: string; costUsd: number | null; knownCostUsd: number; pricedTokens: number }
export type QuotaWindow = {
  id: string; label: string; usedPercent: number; windowMinutes: number;
  resetsAt: number | null; observedAt: number; projected: number | null;
}
export type Quota = { source: 'live' | 'session' | 'unavailable'; windows: QuotaWindow[]; message: string | null }
export type Usage = {
  days: UsageDay[]; totals: Tokens & { costUsd: number | null }; files: number;
  firstDay: string | null; unpricedModels: string[]; warnings: string[];
  models: { model: string; tokens: number; costUsd: number | null; knownCostUsd: number }[];
  costAssumptions: { standardTierEvents: number; shortContextEvents: number; defaultCacheWriteEvents: number };
  lastQuota: { at: number; value: unknown } | null;
}
export type GithubData = {
  fetchedAt: number; total: number; days: { day: string; level: number }[];
  merges: { day: string; prs: number; additions: number; deletions: number }[];
  mergesComplete: boolean;
}
export type Pet = { fed: number; patted: number; highest: number; action: 'feed' | 'pat' | null; actionAt: number }
export type Dashboard = {
  version: 1; updatedAt: number; today: string; timezone: string;
  usage: Omit<Usage, 'lastQuota'>; quota: Quota; pet: Pet;
  pricing: PricingInfo;
  github: GithubData | null; githubStatus: string | null; demo: boolean;
}
export const zeroTokens = (): Tokens => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 })
export function dayAt(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp)
}
