import type { SproutLine } from './types'
import type { PricingInfo } from './server/pricing'
export type Tokens = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number }
export type UsageDay = Tokens & { day: string; costUsd: number | null; knownCostUsd: number; pricedTokens: number }
export type QuotaWindow = {
  id: string; label: string; usedPercent: number; windowMinutes: number;
  resetsAt: number | null; observedAt: number; projected: number | null;
  forecast?: { fullAt: number | null; basis: 'recent' | 'average' };
}
export type Quota = { source: 'live' | 'session' | 'unavailable'; windows: QuotaWindow[]; message: string | null }
export function quotaWindowIsLive(window: QuotaWindow, now = Date.now()) {
  return Number.isFinite(window.observedAt) && window.observedAt <= now &&
    (window.resetsAt ?? window.observedAt + window.windowMinutes * 60_000) > now
}
export type Usage = {
  loading?: boolean;
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
  mergesFrom?: string; latestMerge?: { number: number; at: number } | null;
}
export const PET_ACTIONS = ['feed', 'pat', 'roast', 'pray', 'cat'] as const
export type PetAction = typeof PET_ACTIONS[number]
export type PanelContext = { threadId?: string; cwd?: string }
export type WorkEvent = 'compact' | 'test_failed' | 'test_passed' | 'done' | 'interrupted' | 'approval'
export type Activity = {
  active: number; agents: number; startedAt: number | null; planning: boolean;
  event: { kind: WorkEvent; at: number; failures: number } | null;
}
export type SceneEffect = 'rain' | 'pray' | 'umbrella' | 'hide' | 'burp' | 'guard' | 'cup' | 'compact' | 'agents' | 'flower' | 'return' | 'blanket' | 'fail' | null
export type Pet = {
  fed: number; patted: number; highest: number; action: 'feed' | 'pat' | null; actionAt: number;
  line?: SproutLine | null; initialized?: boolean; levelUpUntil?: number;
  lineCursors?: Record<string, number>;
  lastMergeAt?: number; party?: { number: number; until: number } | null;
  burst?: { action: 'feed' | 'pat'; count: number; at: number };
  prayed?: number; prayerAt?: number; cat?: { until: number; day: string }; nextCatAt?: number;
  lastSeenAt?: number; returnUntil?: number;
  quotaSeen?: Record<string, { used: number; at: number; resetsAt: number | null }>;
  rainUntil?: number;
}
export type Dashboard = {
  version: 1; updatedAt: number; today: string; timezone: string;
  usage: Omit<Usage, 'lastQuota'>; quota: Quota; pet: Pet;
  pricing: PricingInfo;
  github: GithubData | null; githubStatus: string | null; demo: boolean;
  activity?: Activity;
  context?: PanelContext; projectName?: string | null;
}
export const zeroTokens = (): Tokens => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 })
export function dayAt(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp)
}
