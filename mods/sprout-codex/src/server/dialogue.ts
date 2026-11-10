import { createHash } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dashboard } from '../model'
import type { SproutBucket } from '../types'
import { companion } from '../core/companion'
import { personaPools, taskLinesFor } from '../core/personality'
import { LINES } from '../core/lines'
import { loadPersonality, validDialogue } from './personality-config'
import type { DialogueProvider } from './dialogue-provider'
import { readJson, writeJson } from './storage'

type Entry = { key: string; at: number; lines: string[] }
type Cache = { version: 1; day: string; count: number; lastAttempt: number; entries: Entry[] }
const fresh = (day: string): Cache => ({ version:1, day, count:0, lastAttempt:0, entries:[] })

export class DialogueEngine {
  private pending?: Promise<void>
  constructor(readonly dataDir: string, readonly provider?: DialogueProvider) {}
  /** Never wait for a model on the dashboard or an interaction path. */
  async decorate(d: Dashboard, actionBucket?: SproutBucket): Promise<Dashboard> {
    try {
      const loaded = await loadPersonality(this.dataDir)
      const { config, pack, revision } = loaded
      const pools = personaPools(pack, d.task)
      const result: Dashboard = { ...d, dialogue:{ personaId:pack.id, revision, pools, inheritOriginal:pack.inheritOriginal, taskLines:taskLinesFor(pack,d.task) } }
      const bucket = actionBucket ?? companion(result).key
      // OFF means no generated text is consumed either, even if an old cache is present.
      if (!config.generation.enabled || !this.provider) return result
      const key = createHash('sha256').update(JSON.stringify([revision, config.generation.model, d.context?.threadId ?? 'global', d.task?.scenario ?? 'general', d.task?.signals ?? [], bucket])).digest('hex')
      const cache = await readJson<Cache>(join(this.dataDir, 'dialogue-cache.json'), fresh(d.today))
      const entry = cache.version === 1 ? cache.entries.find(e => e.key === key) : undefined
      if (entry && Date.now()-entry.at < 7*86_400_000) {
        const lines = entry.lines.filter(validDialogue)
        if (lines.length >= 2) pools[bucket] = lines
      }
      const exhausted = d.quota.windows.some(w => w.usedPercent >= 100 && Date.now()-w.observedAt < 10*60_000)
      if (!entry || Date.now()-entry.at > 86_400_000) {
        if (!this.pending && !exhausted) {
          this.pending = this.generate(d, loaded, key, bucket, pools[bucket] ?? [...LINES[bucket]])
            .catch(() => {}).finally(() => { this.pending = undefined })
        }
      }
      return result
    } catch {
      // Invalid or partially saved local settings must not take the pet offline.
      return d
    }
  }
  async settled() { await this.pending }
  private async generate(d: Dashboard, loaded: Awaited<ReturnType<typeof loadPersonality>>, key: string, bucket: SproutBucket, examples: string[]) {
    if (!this.provider) return
    const lock = join(this.dataDir, 'dialogue.lock')
    await mkdir(this.dataDir, { recursive:true, mode:0o700 })
    try { await mkdir(lock) } catch {
      try { if (Date.now()-(await stat(lock)).mtimeMs > 120_000) await rm(lock, { recursive:true, force:true }) } catch {}
      return
    }
    try {
      const path = join(this.dataDir, 'dialogue-cache.json')
      const cache = await readJson<Cache>(path, fresh(d.today))
      const now = Date.now(), settings = loaded.config.generation
      if (cache.day !== d.today) { cache.day = d.today; cache.count = 0 }
      if (now-cache.lastAttempt < settings.minIntervalMs || cache.count >= settings.maxBatchesPerDay) return
      if (cache.entries.some(e => e.key === key && now-e.at < 86_400_000)) return
      // Persist reservations before spawning so other MCP instances share the same quota budget.
      cache.count++; cache.lastAttempt = now
      await writeJson(path, cache)
      const recent = cache.entries.filter(e => e.key === key).flatMap(e => e.lines).slice(-12)
      try {
        const generated = await this.provider({ pack:loaded.pack, preferences:loaded.preferences, task:d.task, bucket, examples, recent }, settings)
        const lines = [...new Set(generated.lines.map(line => line.trim()))].filter(line => validDialogue(line) && !recent.includes(line))
        if (lines.length < 2) throw new Error('可用短句不足。')
        // A preference edit or toggle while generation runs invalidates the pending result.
        const latest = await loadPersonality(this.dataDir)
        if (!latest.config.generation.enabled || latest.revision !== loaded.revision || latest.config.generation.model !== settings.model) return
        cache.entries = [...cache.entries.filter(e => e.key !== key && now-e.at < 7*86_400_000), { key, at:now, lines:lines.slice(0,6) }].slice(-128)
        await writeJson(path, cache)
        await writeJson(join(this.dataDir, 'dialogue-status.json'), { at:Date.now(), ok:true, model:settings.model, elapsedMs:generated.elapsedMs, usage:generated.usage })
      } catch {
        await writeJson(join(this.dataDir, 'dialogue-status.json'), { at:Date.now(), ok:false, model:settings.model, reason:'generation_failed' })
      }
    } finally { await rm(lock, { recursive:true, force:true }) }
  }
}
