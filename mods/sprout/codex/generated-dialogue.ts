import { createHash } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LineChoice } from '../hooks/host'
import { lang } from '../hooks/i18n'
import { DialogueEngine } from './dialogue'
import type { DialogueProvider } from './dialogue-provider'
import { generationSettings } from './generation-config'
import type { GenerationSettings } from './generation-config'
import { loadPersonality, readJson, validDialogue, writeJson } from './personality-config'
import type { TaskContext, SproutBucket } from './personas'

type Entry = { key: string; at: number; lines: string[] }
type Cache = { version: 1; day: string; count: number; lastAttempt: number; entries: Entry[] }
const fresh = (day = ''): Cache => ({ version: 1, day, count: 0, lastAttempt: 0, entries: [] })
const DAY = 86_400_000

function cacheOf(raw: unknown): Cache {
  const v = raw as Cache | null
  if (!v || v.version !== 1 || typeof v.day !== 'string' || !Number.isSafeInteger(v.count) || v.count < 0 || !Number.isFinite(v.lastAttempt) || !Array.isArray(v.entries)) return fresh()
  return { ...v, entries: v.entries.filter(e => typeof e?.key === 'string' && Number.isFinite(e.at) && Array.isArray(e.lines) && e.lines.every(validDialogue)).slice(-128) }
}

export class GeneratedDialogueEngine extends DialogueEngine {
  private cache = fresh()
  private pending?: Promise<void>
  private readonly provider: DialogueProvider
  constructor(dir: string, provider: DialogueProvider) { super(dir); this.provider = provider }

  override async prepare(thread = 'global', task?: TaskContext) {
    await super.prepare(thread, task)
    this.cache = fresh()
    try {
      if (generationSettings(this.loaded?.config.generation).enabled) this.cache = cacheOf(await readJson(join(this.dataDir, 'dialogue-cache.json'), null))
    } catch {}
  }

  override chooseLine(choice: LineChoice) {
    this.generated = {}
    try {
      const loaded = this.loaded
      const settings = generationSettings(loaded?.config.generation)
      if (!loaded || !settings.enabled || lang() !== 'zh') return super.chooseLine(choice)
      const bucket = choice.key as SproutBucket
      const key = createHash('sha256').update(JSON.stringify([loaded.revision, settings.model, this.thread, this.task?.scenario ?? 'general', this.task?.signals ?? [], bucket])).digest('hex')
      const entry = this.cache.entries.find(e => e.key === key)
      if (entry && choice.now - entry.at < 7 * DAY && entry.lines.length >= 2) this.generated[bucket] = entry.lines
      const due = !entry || choice.now - entry.at > DAY
      if (due && !this.pending && !choice.exhausted && Date.now() - this.cache.lastAttempt >= settings.minIntervalMs) {
        const task = this.task
        this.pending = this.generate(loaded, task, settings, key, bucket, choice.original(choice.key), choice.today ?? new Date().toLocaleDateString('en-CA'))
          .catch(() => {}).finally(() => { this.pending = undefined })
      }
    } catch {}
    return super.chooseLine(choice)
  }

  async settled() { await this.pending }

  private async generate(loaded: Awaited<ReturnType<typeof loadPersonality>>, task: TaskContext | undefined, settings: GenerationSettings, key: string, bucket: SproutBucket, examples: string[], day: string) {
    const lock = join(this.dataDir, 'dialogue.lock'), path = join(this.dataDir, 'dialogue-cache.json')
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    try { await mkdir(lock) } catch {
      try { if (Date.now() - (await stat(lock)).mtimeMs > 120_000) await rm(lock, { recursive: true, force: true }) } catch {}
      return
    }
    try {
      const cache = cacheOf(await readJson(path, null)), now = Date.now()
      if (cache.day !== day) { cache.day = day; cache.count = 0 }
      if (now - cache.lastAttempt < settings.minIntervalMs || cache.count >= settings.maxBatchesPerDay || cache.entries.some(e => e.key === key && now - e.at < DAY)) return
      cache.count++; cache.lastAttempt = now
      await writeJson(path, cache)
      this.cache = cache
      const recent = cache.entries.filter(e => e.key === key).flatMap(e => e.lines).slice(-12)
      try {
        const result = await this.provider({ pack: loaded.pack, preferences: loaded.preferences, task, bucket, examples, recent }, settings)
        const lines = [...new Set(result.lines.map(line => line.trim()))].filter(line => validDialogue(line) && !recent.includes(line))
        if (lines.length < 2) throw new Error('Insufficient usable lines')
        const latest = await loadPersonality(this.dataDir), current = generationSettings(latest.config.generation)
        if (!current.enabled || latest.revision !== loaded.revision || JSON.stringify(current) !== JSON.stringify(settings)) return
        cache.entries = [...cache.entries.filter(e => e.key !== key && now - e.at < 7 * DAY), { key, at: now, lines: lines.slice(0, 6) }].slice(-128)
        await writeJson(path, cache)
        this.cache = cache
        await writeJson(join(this.dataDir, 'dialogue-status.json'), { at: Date.now(), ok: true, model: settings.model, elapsedMs: result.elapsedMs, usage: result.usage })
      } catch {
        await writeJson(join(this.dataDir, 'dialogue-status.json'), { at: Date.now(), ok: false, model: settings.model, reason: 'generation_failed' })
      }
    } finally { await rm(lock, { recursive: true, force: true }) }
  }
}
