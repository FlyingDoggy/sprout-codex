import type { Dashboard, Pet, PetAction, SceneEffect } from '../model'
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
  const action = now - d.pet.actionAt < ((d.pet.burst?.count ?? 0) >= 2 ? 2800 : d.pet.action === 'feed' ? 1800 : 1200) ? d.pet.action : null
  let mood = windows.some(w => w.usedPercent >= 100) ? 'sleep' : moodOf({
    five: five?.usedPercent ?? null,
    week: week?.usedPercent ?? null,
    isOverForecast: windows.some(w => (w.projected ?? 0) > 100 || (w.windowMinutes !== 10080 && w.usedPercent >= 85)),
    isCelebrating: isLevelUp || party !== null,
  })
  let moodKey: SproutBucket = bucketsFor(mood, hour, streak, { isLevelUp, lost })[0] ?? 'happy'
  let effect: SceneEffect = null
  const showCat = (d.pet.cat?.until ?? 0) > now
  const canPray = mood === 'worry' || mood === 'sleep'
  const activity = now - d.updatedAt < 90_000 ? d.activity : undefined
  const work = activity?.event && now - activity.event.at < 90_000 && activity.event.at <= now ? activity.event : null
  const raining = (d.pet.rainUntil ?? 0) > now && mood !== 'sleep'
  if (raining) { moodKey = 'reset'; effect = 'rain'; mood = 'party' }
  else if (mood !== 'sleep' && !isLevelUp && !party) {
    if (work) {
      moodKey = work.kind
      effect = work.kind === 'compact' ? 'compact' : work.kind === 'test_passed' ? 'flower' : work.kind === 'test_failed' ? 'fail' : null
      if (work.kind === 'test_passed') mood = 'party'
    } else if ((d.pet.returnUntil ?? 0) > now) { moodKey = 'return'; effect = 'return' }
    else if (activity && activity.agents > 0 && activity.active > 1) { moodKey = 'agents'; effect = 'agents' }
    else if (activity?.active && activity.startedAt && now - activity.startedAt >= 120_000) {
      moodKey = activity.planning ? 'planning' : 'busy'; effect = 'cup'
    }
  }
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
    fed: d.pet.fed, patted: d.pet.patted, time: local, agents: activity?.active ?? 0, failures: work?.failures ?? 0,
  }
  const line = d.pet.line
  const eventAt = Math.max(work?.at ?? 0, raining ? (d.pet.rainUntil ?? 0) - 60_000 : 0)
  const isLive = line && now >= line.at && now - line.at < LINE_FRESH_MS && (!raining || line.at > (d.pet.rainUntil ?? 0) - 60_000) &&
    (line.at >= eventAt || action !== null) &&
    (['feed', 'pat', 'overwater', 'overpat', 'pray', 'cat'].includes(line.bucket) || line.bucket === moodKey)
  const key: SproutBucket = isLive ? line.bucket : moodKey
  const buckets: SproutBucket[] = [key]
  // A manual roast talks about work, not the previous watering/patting action.
  // Short event pools share the persona's everyday banter after their specific lines.
  if (isLive && line.roast && ['busy', 'planning', 'compact', 'agents', 'test_failed', 'test_passed', 'done', 'interrupted', 'approval', 'return'].includes(key)) buckets.push('happy')
  if (buckets.includes('happy') && streak >= 7) buckets.push('streak')
  const pool = [...new Set(buckets.flatMap(bucket => {
    return linesFor([bucket], context).map(line => line.text)
  }))]
  const index = isLive ? line.index : key === 'test_failed' ? Math.min(2, Math.max(0, (work?.failures ?? 1) - 1)) : Math.floor(now / AUTO_LINE_MS) + Number.parseInt(hashOf(d.today), 36)
  if (now - (d.pet.prayerAt ?? 0) < 4000) { effect = 'pray'; mood = 'party' }
  if (action && (d.pet.burst?.count ?? 0) >= 3) effect = action === 'feed' ? 'umbrella' : 'hide'
  else if (action && d.pet.burst?.count === 2) effect = action === 'feed' ? 'burp' : 'guard'
  if (!effect && hour < 5) effect = 'blanket'
  if (action === 'pat' && mood !== 'sleep') mood = 'party'
  return {
    mood, moodKey, action, hour, streak, key, index, effect, showCat, canPray, agents: activity?.agents ?? 0,
    text: pool[index % pool.length] ?? '……',
    isConfetti: (isLevelUp || party !== null) && mood === 'party',
    isPop: now - Math.max(d.pet.actionAt, line?.at ?? 0) < 1000,
  }
}

export function interactPet(pet: Pet, action: PetAction, dashboard?: Dashboard, now = Date.now()): Pet {
  const model = dashboard ? companion({ ...dashboard, pet }, now) : null
  const repeated = action === 'feed' || action === 'pat'
  const count = repeated && pet.burst?.action === action && now - pet.burst.at < 12_000 ? pet.burst.count + 1 : 1
  const bucket: SproutBucket = action === 'roast' ? model?.moodKey ?? 'happy'
    : action === 'feed' && count >= 3 ? 'overwater' : action === 'pat' && count >= 3 ? 'overpat' : action
  const roast = action === 'roast'
  const cursorKey = `classic/${roast ? 'roast' : 'care'}/${bucket}`
  // Each action/persona resumes its own rotation even when buttons are interleaved.
  const previous = pet.lineCursors?.[cursorKey] ?? (model?.key === bucket ? model.index : pet.line?.bucket === bucket ? pet.line.index : Math.floor(now / 1000) % 97)
  const index = previous + 1
  const lineCursors = Object.fromEntries([...Object.entries(pet.lineCursors ?? {}).filter(([key]) => key !== cursorKey), [cursorKey, index]].slice(-128))
  return {
    ...pet,
    ...(!repeated ? { action: null, actionAt: 0, burst: undefined } : {}),
    ...(roast ? { prayerAt: 0 } : {}),
    ...(repeated ? { [action === 'feed' ? 'fed' : 'patted']: pet[action === 'feed' ? 'fed' : 'patted'] + 1, action, actionAt: now, burst: { action, count, at: now } } : {}),
    ...(action === 'pray' ? { prayed: (pet.prayed ?? 0) + 1, prayerAt: now } : {}),
    ...(action === 'cat' ? { cat: { day: dashboard?.today ?? new Date(now).toISOString().slice(0,10), until: now + 90_000 }, nextCatAt: now + 24 * 3_600_000 } : {}),
    lineCursors,
    line: { bucket, index, at: now, ...(roast ? { roast: true } : {}) },
  }
}
