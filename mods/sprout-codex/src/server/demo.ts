import { dayAt, zeroTokens, type Dashboard } from '../model'
import { PRICING_URL } from './pricing'

export function demoDashboard(now = Date.now()): Dashboard {
  const timezone = 'Asia/Shanghai'
  const days = Array.from({ length: 90 }, (_, i) => {
    const input = Math.round((1.3 + Math.sin(i * 0.71) * 0.5) * 100_000_000)
    const output = Math.round(input / 20)
    return { day: dayAt(now - (89 - i) * 86_400_000, timezone), input, output, cached: Math.round(input * 0.81), cacheWrite: 0, reasoning: Math.round(output / 2), total: input + output, costUsd: null, knownCostUsd: 0, pricedTokens: 0 }
  })
  const totals = days.reduce((sum, day) => ({ input: sum.input + day.input, output: sum.output + day.output, cached: sum.cached + day.cached, cacheWrite: 0, reasoning: sum.reasoning + day.reasoning, total: sum.total + day.total }), zeroTokens())
  return { version: 1, updatedAt: now, today: dayAt(now, timezone), timezone, demo: true,
    usage: { days, totals: { ...totals, costUsd: null }, firstDay: days[0].day, files: 108, unpricedModels: ['demo'], models: [{ model: 'demo', tokens: totals.total, costUsd: null, knownCostUsd: 0 }], costAssumptions: { standardTierEvents: 0, shortContextEvents: 0, defaultCacheWriteEvents: 0 }, warnings: [] },
    pricing: { sourceUrl: PRICING_URL, checkedAt: now, source: 'bundled', warning: null, customModels: [] },
    quota: { source: 'session', message: '演示读数，用于界面预览。', windows: [{ id: 'demo:week', label: 'Codex · 1 周', usedPercent: 45, windowMinutes: 10080, resetsAt: now + 2 * 86_400_000, observedAt: now, projected: 77 }] },
    pet: { fed: 12, patted: 28, highest: 2, action: null, actionAt: 0 },
    github: { fetchedAt: now, total: 854, days: Array.from({ length: 365 }, (_, i) => ({ day: dayAt(now - (364 - i) * 86_400_000, timezone), level: (i * 17 + Math.floor(i / 7)) % 5 })), merges: days.slice(-30).map((d, i) => ({ day: d.day, prs: i % 5, additions: (i % 7) * 62, deletions: (i % 4) * 33 })), mergesComplete: true }, githubStatus: null,
  }
}

export function demoService() {
  const dashboard = demoDashboard()
  return {
    async get(_force = false) { return dashboard },
    async interact(action: 'feed' | 'pat') {
      dashboard.pet[action === 'feed' ? 'fed' : 'patted']++
      dashboard.pet.action = action; dashboard.pet.actionAt = Date.now()
      return dashboard.pet
    },
  }
}
