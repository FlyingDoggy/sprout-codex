import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, stat } from 'node:fs/promises'
import { quotaWindowIsLive, dayAt, type Dashboard, type GithubData, type Pet, type PetAction, type Quota, type PanelContext } from '../model'
import { activityOf, threadActivity, type ActivityState } from './activity'
import { folderName } from './context'
import { interactPet } from '../core/companion'
import { observePet } from '../core/pet-events'
import { growthStep, forecast } from '../core/logic'
import { scanUsage, readCachedUsage, type Prices } from './usage'
import { getQuota } from './codex'
import { readGithub } from './github'
import { readJson, writeJson } from './storage'
import { loadPrices } from './pricing'
import { DialogueEngine } from './dialogue'
import { listPersonalities } from './personality-config'
import { personalityCommand } from './personality-cli'

export type Options = { codexHome: string; dataDir: string; timezone: string; binary: string; live: boolean; github: boolean; prices: Prices; refreshPrices?: boolean }
export function optionsFromEnv(): Options {
  const codexHome = process.env.SPROUT_CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const timezone = process.env.SPROUT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  dayAt(Date.now(), timezone)
  return { codexHome, dataDir: process.env.SPROUT_DATA_DIR ?? join(codexHome, 'sprout'), timezone, binary: process.env.SPROUT_CODEX_BIN ?? 'codex', live: process.env.SPROUT_LIVE_QUOTA !== '0', github: process.env.SPROUT_GITHUB !== '0', prices: {}, refreshPrices: process.env.SPROUT_PRICE_REFRESH !== '0' }
}

const initialPet = (): Pet => ({ fed: 0, patted: 0, highest: 1, action: null, actionAt: 0 })
async function mutatePet(dataDir: string, change: (pet: Pet) => Pet): Promise<Pet> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lock = join(dataDir, 'pet.lock')
  const deadline = Date.now() + 5000
  for (;;) {
    try { await mkdir(lock); break } catch (error: any) {
      if (error.code !== 'EEXIST') throw error
      try { if (Date.now() - (await stat(lock)).mtimeMs > 30_000) await rm(lock, { recursive: true }) } catch {}
      if (Date.now() > deadline) throw new Error('小苗状态正在保存，请稍后重试。')
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  }
  try {
    const path = join(dataDir, 'pet.json')
    const previous = await readJson(path, initialPet())
    const before = JSON.stringify(previous)
    const pet = change(previous)
    if (JSON.stringify(pet) !== before) await writeJson(path, pet)
    return pet
  } finally { await rm(lock, { recursive: true, force: true }) }
}

export class SproutService {
  private snapshot?: Dashboard
  private collecting?: Promise<Dashboard>
  private quota?: { at: number; value: Quota }
  private github?: { at: number; value: GithubData | null; status: string | null }
  private prices?: { at: number; value: Awaited<ReturnType<typeof loadPrices>> }
  private activityStates: ActivityState[] = []
  private dialogue: DialogueEngine
  private bootstrap?: Promise<Dashboard>
  private scanAt = 0
  private refreshing = new Map<string, Promise<void>>()
  private remoteAt: Record<string, number> = {}
  constructor(readonly options: Options, private readonly deps = { scanUsage, getQuota, readGithub, loadPrices }) { this.dialogue = new DialogueEngine(options.dataDir) }

  private background(key: string, interval: number, task: () => Promise<void>) {
    if (this.refreshing.has(key) || Date.now() - (this.remoteAt[key] ?? 0) < interval) return
    this.remoteAt[key] = Date.now()
    const work = task().catch(() => {}).finally(() => { this.refreshing.delete(key) })
    this.refreshing.set(key, work)
  }

  /** CLI/diagnostics can await local indexing; interactive get() never waits for it. */
  async refresh(context: PanelContext = {}) {
    await this.get(true, context)
    await this.collecting
    return this.get(false, context)
  }

  async settled() { await this.collecting; await Promise.all(this.refreshing.values()) }

  private async contextual(data: Dashboard, context: PanelContext): Promise<Dashboard> {
    const own = context.threadId ? this.activityStates.filter(s => s.session === context.threadId).sort((a,b) => b.updatedAt-a.updatedAt)[0] : undefined
    return this.dialogue.decorate({ ...data, context, projectName: folderName(own?.cwd || context.cwd), task:own?.task,
      activity: activityOf(context.threadId ? threadActivity(this.activityStates, context.threadId) : this.activityStates) })
  }

  async get(force = false, context: PanelContext = {}): Promise<Dashboard> {
    if (!this.snapshot) {
      this.bootstrap ??= this.collect(true)
      this.snapshot = await this.bootstrap
    }
    if (!this.collecting && (force || Date.now() - this.scanAt >= 15_000)) {
      this.scanAt = Date.now()
      this.collecting = this.collect(false).then(data => this.snapshot = data).catch(() => {
        this.snapshot!.usage.warnings = ['本机记录暂时无法刷新，保留上次统计。']
        return this.snapshot!
      }).finally(() => { this.collecting = undefined })
    }
    this.snapshot.pet = await readJson(join(this.options.dataDir, 'pet.json'), this.snapshot.pet)
    return this.contextual(this.snapshot, context)
  }

  async personalities() { return listPersonalities(this.options.dataDir) }

  async selectPersonality(id: string, context: PanelContext = {}) {
    await personalityCommand(this.options.dataDir, ['use', id])
    return this.get(false, context)
  }

  private async collect(cached: boolean): Promise<Dashboard> {
    const opts = this.options
    this.prices ??= { at: Date.now(), value: await this.deps.loadPrices(opts.dataDir, false, opts.prices) }
    if (opts.refreshPrices) this.background('prices', 3_600_000, async () => {
      const value = await this.deps.loadPrices(opts.dataDir, true, opts.prices)
      if (JSON.stringify(value.prices) !== JSON.stringify(this.prices!.value.prices)) this.scanAt = 0
      this.prices = { at: Date.now(), value }
    })
    const pricing = this.prices.value
    const usage = cached ? await readCachedUsage(opts.dataDir, opts.timezone)
      : await this.deps.scanUsage(opts.codexHome, opts.dataDir, opts.timezone, pricing.prices)
    if (!this.quota) this.quota = await readJson(join(opts.dataDir, 'quota.json'), undefined)
    const fallback = await getQuota({ ...opts, live: false }, usage.lastQuota)
    const liveWindows = this.quota?.value.windows.filter(w => quotaWindowIsLive(w)) ?? []
    const cachedAt = Math.max(0, ...liveWindows.map(w => w.observedAt))
    const fallbackAt = Math.max(0, ...fallback.windows.map(w => w.observedAt))
    const quota: Quota = liveWindows.length && cachedAt >= fallbackAt ? { ...this.quota!.value, windows: liveWindows } : fallback
    if (opts.live) this.background('quota', 60_000, async () => {
      const value = await this.deps.getQuota(opts, usage.lastQuota)
      if (value.windows.length && Math.max(...value.windows.map(w => w.observedAt)) >= Math.max(0, ...(this.quota?.value.windows.filter(w => quotaWindowIsLive(w)).map(w => w.observedAt) ?? []))) {
        this.quota = { at: Date.now(), value }
        await writeJson(join(opts.dataDir, 'quota.json'), this.quota)
      }
    })
    if (!this.github) {
      const saved = opts.github ? await readJson<GithubData | null>(join(opts.dataDir, 'github.json'), null) : null
      this.github = { at: saved?.fetchedAt ?? 0, value: saved, status: opts.github ? null : 'GitHub 统计未启用。' }
    }
    if (opts.github && !usage.loading && (!this.github.value || Date.now() - this.github.at > 30 * 60_000 || usage.firstDay && usage.firstDay !== this.github.value.mergesFrom)) {
      this.background('github', 30 * 60_000, async () => {
        try {
          const value = await this.deps.readGithub(opts.timezone, Date.now(), usage.firstDay ?? undefined)
          this.github = { at: Date.now(), value, status: null }
          await writeJson(join(opts.dataDir, 'github.json'), value)
        } catch { this.github!.status = 'GitHub 暂不可用，请检查 gh 的 github.com 登录状态。' }
      })
    }
    const github = this.github
    const samplesPath = join(opts.dataDir, 'quota-samples.json')
    const samples = await readJson<Record<string, { at: number; pct: number }[]>>(samplesPath, {})
    const previousSamples = JSON.stringify(samples)
    const windows = quota.windows.filter(w => quotaWindowIsLive(w)).map(window => {
      const key = `${window.id}:${window.resetsAt}`
      const history = (samples[key] ?? []).filter(p => p.at > Date.now() - 8 * 86_400_000)
      if (!history.some(p => p.at === window.observedAt)) history.push({ at: window.observedAt, pct: window.usedPercent })
      samples[key] = history.slice(-1500)
      const fresh = Date.now() - window.observedAt < 10 * 60_000
      const fc = fresh && window.resetsAt ? forecast(history, { pct: window.usedPercent, at: window.observedAt, resetsAt: window.resetsAt }, { windowMs: window.windowMinutes * 60_000, lookbackMs: Math.min(86_400_000, window.windowMinutes * 60_000 / 5) }) : null
      return { ...window, projected: fc?.projected ?? null, forecast: fc ? { fullAt: fc.fullAt, basis: fc.basis } : undefined }
    })
    for (const key of Object.keys(samples)) if (!samples[key].some(p => p.at > Date.now() - 8 * 86_400_000)) delete samples[key]
    if (JSON.stringify(samples) !== previousSamples) await writeJson(samplesPath, samples)
    const pet = await mutatePet(opts.dataDir, pet => {
      if (usage.loading) return pet
      const growth = growthStep(pet.initialized ? pet.highest : null, usage.totals.total)
      const latest = github.value?.latestMerge
      const isMerge = latest && latest.at > (pet.lastMergeAt ?? 0) && Date.now() - latest.at < (pet.lastMergeAt === undefined ? 10 * 60_000 : 6 * 3_600_000)
      return { ...observePet(pet, windows, opts.timezone), highest: Math.max(pet.highest, growth.highest), initialized: true,
        levelUpUntil: growth.isLevelUp ? Date.now() + 10 * 60_000 : pet.levelUpUntil,
        lastMergeAt: latest?.at ?? pet.lastMergeAt,
        party: isMerge ? { number: latest.number, until: Date.now() + 10 * 60_000 } : pet.party,
      }
    })
    const { lastQuota: _, activity, activityStates, ...publicUsage } = usage
    this.activityStates = activityStates
    return { version: 1, updatedAt: Date.now(), today: dayAt(Date.now(), opts.timezone), timezone: opts.timezone, usage: publicUsage, activity, pricing: pricing.info, quota: { ...quota, windows }, pet, github: github.value, githubStatus: github.status, demo: false }
  }

  async interact(action: PetAction, context: PanelContext = {}): Promise<Pet> {
    const dashboard = action === 'roast' || action === 'cat' || action === 'pray' ? await this.get(false, context) : this.snapshot ? await this.contextual(this.snapshot, context) : undefined
    const pet = await mutatePet(this.options.dataDir, pet => interactPet(pet, action, dashboard))
    if (this.snapshot) this.snapshot.pet = pet
    return pet
  }
}
