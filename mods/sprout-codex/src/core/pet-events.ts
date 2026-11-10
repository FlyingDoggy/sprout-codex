import { dayAt, type Pet, type QuotaWindow } from '../model'

/** Persist observation edges, so refreshes and process restarts cannot replay a reset. */
export function observePet(pet: Pet, windows: QuotaWindow[], timezone: string, now = Date.now()): Pet {
  const next = { ...pet, quotaSeen: { ...pet.quotaSeen }, lastSeenAt: now }
  let recovered = false
  for (const w of windows) {
    if (w.observedAt > now || now - w.observedAt > 5 * 60_000 || w.resetsAt !== null && w.resetsAt <= now) continue
    const before = next.quotaSeen[w.id]
    if (before && w.observedAt > before.at && now - before.at < 8 * 86_400_000 && before.used >= 50 && w.usedPercent <= 20 && before.used - w.usedPercent >= 40) recovered = true
    if (!before || w.observedAt > before.at) next.quotaSeen[w.id] = { used: w.usedPercent, at: w.observedAt, resetsAt: w.resetsAt }
  }
  for (const [key, value] of Object.entries(next.quotaSeen)) if (now - value.at > 8 * 86_400_000) delete next.quotaSeen[key]
  if (recovered) next.rainUntil = now + 60_000
  if (pet.lastSeenAt && now - pet.lastSeenAt >= 2 * 86_400_000) next.returnUntil = now + 60_000
  const today = dayAt(now, timezone)
  if (!pet.nextCatAt) next.nextCatAt = now + 60_000
  else if (now >= pet.nextCatAt && pet.cat?.day !== today) {
    next.cat = { day: today, until: now + 90_000 }
    next.nextCatAt = now + 24 * 3_600_000
  }
  return next
}
