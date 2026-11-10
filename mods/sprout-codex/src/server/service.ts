import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dayAt, type Dashboard, type GithubData, type Pet, type Quota } from '../model'
import { levelForTokens, forecast } from '../core/logic'
import { scanUsage, type Prices } from './usage'
import { getQuota } from './codex'
import { readGithub } from './github'
import { readJson, writeJson } from './storage'

export type Options = { codexHome: string; dataDir: string; timezone: string; binary: string; live: boolean; github: boolean; prices: Prices }
export function optionsFromEnv(): Options {
  const codexHome = process.env.SPROUT_CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const timezone = process.env.SPROUT_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  dayAt(Date.now(), timezone)
  return { codexHome, dataDir: process.env.SPROUT_DATA_DIR ?? join(codexHome, 'sprout'), timezone, binary: process.env.SPROUT_CODEX_BIN ?? 'codex', live: process.env.SPROUT_LIVE_QUOTA !== '0', github: process.env.SPROUT_GITHUB !== '0', prices: {} }
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
    const pet = change(await readJson(path, initialPet()))
    await writeJson(path, pet)
    return pet
  } finally { await rm(lock, { recursive: true, force: true }) }
}

export class SproutService {
  private snapshot?: Dashboard
  private collecting?: Promise<Dashboard>
  private quota?: { at: number; value: Quota }
  private github?: { at: number; value: GithubData | null; status: string | null }
  constructor(readonly options: Options) {}

  async get(force = false): Promise<Dashboard> {
    if (this.collecting) return this.collecting
    if (!force && this.snapshot && Date.now() - this.snapshot.updatedAt < 30_000) {
      this.snapshot.pet = await readJson(join(this.options.dataDir, 'pet.json'), this.snapshot.pet)
      return this.snapshot
    }
    this.collecting = this.collect()
    try { this.snapshot = await this.collecting; return this.snapshot } finally { this.collecting = undefined }
  }

  private async collect(): Promise<Dashboard> {
    const opts = this.options
    const usage = await scanUsage(opts.codexHome, opts.dataDir, opts.timezone, opts.prices)
    const quotaTask = async () => {
      if (!this.quota || Date.now() - this.quota.at > 60_000) {
        const value = await getQuota(opts, usage.lastQuota)
        this.quota = { at: Date.now(), value }
      }
      return this.quota.value
    }
    const githubTask = async () => {
      if (!opts.github) return { value: null, status: 'GitHub 统计未启用。' }
      if (!this.github) {
        const saved = await readJson<GithubData | null>(join(opts.dataDir, 'github.json'), null)
        if (saved) this.github = { at: saved.fetchedAt, value: saved, status: null }
      }
      if (!this.github || Date.now() - this.github.at > 30 * 60_000) {
        try {
          const value = await readGithub(opts.timezone)
          await writeJson(join(opts.dataDir, 'github.json'), value)
          this.github = { at: Date.now(), value, status: null }
        } catch { this.github = { at: Date.now(), value: this.github?.value ?? null, status: 'GitHub 暂不可用，请检查 gh 的 github.com 登录状态。' } }
      }
      return this.github
    }
    const [quota, github] = await Promise.all([quotaTask(), githubTask()])
    const samplesPath = join(opts.dataDir, 'quota-samples.json')
    const samples = await readJson<Record<string, { at: number; pct: number }[]>>(samplesPath, {})
    const windows = quota.windows.filter(w => w.resetsAt === null || w.resetsAt > Date.now()).map(window => {
      const key = `${window.id}:${window.resetsAt}`
      const history = (samples[key] ?? []).filter(p => p.at > Date.now() - 8 * 86_400_000)
      if (!history.some(p => p.at === window.observedAt)) history.push({ at: window.observedAt, pct: window.usedPercent })
      samples[key] = history.slice(-1500)
      const fresh = Date.now() - window.observedAt < 10 * 60_000
      const projected = fresh && window.resetsAt ? forecast(history, { pct: window.usedPercent, at: window.observedAt, resetsAt: window.resetsAt }, { windowMs: window.windowMinutes * 60_000, lookbackMs: Math.min(86_400_000, window.windowMinutes * 60_000 / 4) }).projected : null
      return { ...window, projected }
    })
    for (const key of Object.keys(samples)) if (!samples[key].some(p => p.at > Date.now() - 8 * 86_400_000)) delete samples[key]
    await writeJson(samplesPath, samples)
    const pet = await mutatePet(opts.dataDir, pet => ({ ...pet, highest: Math.max(pet.highest, levelForTokens(usage.totals.total)) }))
    const { lastQuota: _, ...publicUsage } = usage
    return { version: 1, updatedAt: Date.now(), today: dayAt(Date.now(), opts.timezone), timezone: opts.timezone, usage: publicUsage, quota: { ...quota, windows }, pet, github: github.value, githubStatus: github.status, demo: false }
  }

  async interact(action: 'feed' | 'pat'): Promise<Pet> {
    const pet = await mutatePet(this.options.dataDir, pet => ({ ...pet, [action === 'feed' ? 'fed' : 'patted']: pet[action === 'feed' ? 'fed' : 'patted'] + 1, action, actionAt: Date.now() }))
    if (this.snapshot) this.snapshot.pet = pet
    return pet
  }
}
