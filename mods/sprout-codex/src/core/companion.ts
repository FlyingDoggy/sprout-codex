import type { Dashboard, Pet, PetAction } from '../model'
import type { SproutBucket } from '../types'
import { bucketsFor, formatTokens, formatUsd, hashOf, lostStreakOf, moodOf, streakOf } from './logic'
import { levelLabel } from './levels'
import { linesFor, type LineContext } from './lines'

const LINE_FRESH_MS = 5 * 60_000
const AUTO_LINE_MS = 10 * 60_000

/** Upstream readModel's companion logic, independent of either host's UI runtime. */
export function companion(d: Dashboard, now = Date.now()) {
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: d.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const hour = Number(local.slice(0, 2))
  const active = d.usage.days.filter(day => day.total > 0).map(day => day.day)
  const streak = streakOf(active, d.today)
  const lost = lostStreakOf(active, d.today)
  const windows = d.quota.windows.filter(w => w.resetsAt === null || w.resetsAt > now)
  const five = windows.find(w => w.windowMinutes === 300)
  const week = windows.find(w => w.windowMinutes === 10080)
  const isLevelUp = (d.pet.levelUpUntil ?? 0) > now
  const party = d.pet.party && d.pet.party.until > now ? d.pet.party : null
  const action = now - d.pet.actionAt < (d.pet.action === 'feed' ? 1800 : 1200) ? d.pet.action : null
  const mood = windows.some(w => w.usedPercent >= 100) ? 'sleep' : moodOf({
    five: five?.usedPercent ?? null,
    week: week?.usedPercent ?? null,
    isOverForecast: windows.some(w => (w.projected ?? 0) > 100 || (w.windowMinutes !== 10080 && w.usedPercent >= 85)),
    isCelebrating: isLevelUp || party !== null || action === 'pat',
  })
  const moodKey = bucketsFor(mood, hour, streak, { isLevelUp, lost })[0] ?? 'happy'
  const time = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const fullAt = windows.map(w => w.forecast?.fullAt).filter((at): at is number => at != null && at > now).sort((a, b) => a - b)[0]
  const reset = windows.filter(w => w.usedPercent >= 100).map(w => w.resetsAt).filter((at): at is number => at !== null).sort((a, b) => b - a)[0] ?? five?.resetsAt
  const today = d.usage.days.find(day => day.day === d.today)
  const context: LineContext = {
    streak, lost, level: levelLabel(d.pet.highest),
    total: d.usage.totals.costUsd === null ? null : formatUsd(d.usage.totals.costUsd),
    today: today?.costUsd ? formatUsd(today.costUsd) : null,
    hit: d.usage.totals.input ? `${Math.round(d.usage.totals.cached / d.usage.totals.input * 100)}%` : null,
    tokens: formatTokens(d.usage.totals.total),
    five: five ? `${Math.round(five.usedPercent)}%` : null,
    week: week ? `${Math.round(week.usedPercent)}%` : null,
    fullAt: fullAt === undefined ? null : time(fullAt), reset: reset ? time(reset) : null,
    pr: party ? `#${party.number}` : null,
    fed: d.pet.fed, patted: d.pet.patted, time: local,
  }
  const line = d.pet.line
  const isLive = line && now - line.at < LINE_FRESH_MS && (line.bucket === 'feed' || line.bucket === 'pat' || line.bucket === moodKey)
  const key: SproutBucket = isLive ? line.bucket : moodKey
  const pool = linesFor(key === 'happy' && streak >= 7 ? ['happy', 'streak'] : [key], context)
  const index = isLive ? line.index : Math.floor(now / AUTO_LINE_MS) + Number.parseInt(hashOf(d.today), 36)
  return {
    mood, moodKey, action, hour, streak, key, index,
    text: pool[index % pool.length]?.text ?? '……',
    isConfetti: (isLevelUp || party !== null) && mood === 'party',
    isPop: now - Math.max(d.pet.actionAt, line?.at ?? 0) < 1000,
  }
}

export function interactPet(pet: Pet, action: PetAction, dashboard?: Dashboard, now = Date.now()): Pet {
  const model = dashboard ? companion({ ...dashboard, pet }, now) : null
  const bucket: SproutBucket = action === 'roast' ? model?.moodKey ?? 'happy' : action
  // Advance from the displayed line as well as from a previous click, so the first roast changes it.
  const previous = model?.key === bucket ? model.index : pet.line?.bucket === bucket ? pet.line.index : Math.floor(now / 1000) % 97
  return {
    ...pet,
    ...(action === 'roast' ? {} : { [action === 'feed' ? 'fed' : 'patted']: pet[action === 'feed' ? 'fed' : 'patted'] + 1, action, actionAt: now }),
    line: { bucket, index: previous + 1, at: now },
  }
}
