export type Tokens = { input: number; cached: number; output: number; reasoning: number; total: number }
export type UsageDay = Tokens & { day: string; costUsd: number | null }
export type QuotaWindow = {
  id: string; label: string; usedPercent: number; windowMinutes: number;
  resetsAt: number | null; observedAt: number; projected: number | null;
}
export type Quota = { source: 'live' | 'session' | 'unavailable'; windows: QuotaWindow[]; message: string | null }
export type Usage = {
  days: UsageDay[]; totals: Tokens & { costUsd: number | null }; files: number;
  firstDay: string | null; unpricedModels: string[]; warnings: string[];
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
  github: GithubData | null; githubStatus: string | null; demo: boolean;
}
export const zeroTokens = (): Tokens => ({ input: 0, cached: 0, output: 0, reasoning: 0, total: 0 })
export function dayAt(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp)
}
