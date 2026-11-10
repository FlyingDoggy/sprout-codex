import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LINES } from '../hooks/lines'
import { wrapText } from '../hooks/logic'
import { CODEX_BUCKETS } from './lines'
import { CLASSIC_PERSONA, DELIVERY_PERSONA, TASK_SCENARIOS, TASK_SIGNALS } from './personas'
import type { PersonaPack, PersonalityMenu, TaskScenario } from './personas'

type Json = Record<string, any>
export type PersonalityConfig = Json & { schemaVersion: 1; persona: string }
export type Preference = { id: string; text: string; scopes: TaskScenario[]; source: string; updatedAt: string }
const ID = /^[a-z0-9_-]{1,60}$/
const object = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const buckets = [...Object.keys(LINES), ...CODEX_BUCKETS]

export function validDialogue(value: unknown): value is string {
  return text(value, 100) && !/[<>\n\r\u0000-\u001f]|\{\w+\}/.test(value) && !wrapText(value, 11, 3).isCut
}

function pools(value: unknown, keys: readonly string[]) {
  if (value === undefined) return {}
  if (!object(value)) throw new Error('Invalid dialogue pools')
  for (const [key, lines] of Object.entries(value)) {
    if (!keys.includes(key) || !Array.isArray(lines) || lines.length < 2 || lines.length > 40 || !lines.every(validDialogue)) throw new Error('Invalid dialogue pool')
  }
  return value
}

export function parsePersona(value: unknown, id: string): PersonaPack {
  if (!object(value) || !ID.test(id) || value.id !== id || value.schemaVersion !== 1 || !text(value.name, 80) || !text(value.version, 40)) throw new Error('Invalid persona')
  const allowed = ['schemaVersion', 'id', 'version', 'extends', 'name', 'identity', 'voice', 'inheritOriginal', 'pools', 'scenes', 'signals']
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown persona field')
  if (value.extends !== undefined && !['classic', 'delivery'].includes(value.extends)) throw new Error('Unknown base persona')
  if (value.identity !== undefined && !text(value.identity, 1200)) throw new Error('Invalid identity')
  if (value.inheritOriginal !== undefined && typeof value.inheritOriginal !== 'boolean') throw new Error('Invalid inheritance')
  if (value.voice !== undefined && (!Array.isArray(value.voice) || value.voice.length > 16 || !value.voice.every((v: unknown) => text(v, 500)))) throw new Error('Invalid voice')
  const base = value.extends === 'delivery' ? DELIVERY_PERSONA : CLASSIC_PERSONA
  return { ...base, id, version: value.version, name: value.name, identity: value.identity ?? base.identity, voice: value.voice ?? base.voice,
    inheritOriginal: value.inheritOriginal ?? base.inheritOriginal,
    pools: { ...base.pools, ...pools(value.pools, buckets) }, scenes: { ...base.scenes, ...pools(value.scenes, TASK_SCENARIOS) }, signals: { ...base.signals, ...pools(value.signals, TASK_SIGNALS) } }
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    if ((await stat(path)).size > 1024 * 1024) throw new Error('Settings file too large')
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error: any) { if (error.code === 'ENOENT') return fallback; throw error }
}

export async function writeJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 })
  await rename(temp, path)
}

export async function readConfig(dir: string): Promise<PersonalityConfig> {
  const raw = await readJson<unknown>(join(dir, 'personality.json'), {})
  if (!object(raw) || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) || (raw.persona !== undefined && (typeof raw.persona !== 'string' || !ID.test(raw.persona)))) throw new Error('Invalid personality settings')
  return { ...raw, schemaVersion: 1, persona: raw.persona ?? 'classic' }
}

function preferences(raw: unknown): Preference[] {
  if (!object(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.preferences) || raw.preferences.length > 40) throw new Error('Invalid preferences')
  return raw.preferences.map((p: unknown) => {
    if (!object(p) || !text(p.id, 80) || !/^[a-z0-9_-]+$/.test(p.id) || !text(p.text, 400) || !text(p.source, 600) || !text(p.updatedAt, 40) ||
      (p.scopes !== undefined && (!Array.isArray(p.scopes) || p.scopes.length > TASK_SCENARIOS.length || !p.scopes.every((s: any) => TASK_SCENARIOS.includes(s))))) throw new Error('Invalid preference')
    return { id: p.id, text: p.text, source: p.source, updatedAt: p.updatedAt, scopes: p.scopes ?? [] }
  })
}

async function packAt(dir: string, id: string) {
  if (!ID.test(id)) throw new Error('Invalid persona id')
  return id === 'classic' ? CLASSIC_PERSONA : id === 'delivery' ? DELIVERY_PERSONA : parsePersona(await readJson(join(dir, 'personas', `${id}.json`), null), id)
}

export async function loadPersonality(dir: string) {
  const config = await readConfig(dir)
  const pack = await packAt(dir, config.persona)
  const memory = preferences(await readJson(join(dir, 'preferences.json'), { schemaVersion: 1, preferences: [] }))
  const revision = createHash('sha256').update(JSON.stringify([pack, memory])).digest('hex').slice(0, 24)
  return { config, pack, preferences: memory, revision }
}

export async function listPersonalities(dir: string): Promise<PersonalityMenu> {
  let current = 'classic'
  try { current = (await readConfig(dir)).persona } catch {}
  const choices = [CLASSIC_PERSONA, DELIVERY_PERSONA].map(({ id, name }) => ({ id, name }))
  let files: string[] = []
  try { files = await readdir(join(dir, 'personas')) } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  for (const file of files.sort()) {
    const id = file.replace(/\.json$/, '')
    if (!file.endsWith('.json') || !ID.test(id) || choices.some(p => p.id === id)) continue
    try { const pack = await packAt(dir, id); choices.push({ id, name: pack.name }) } catch {}
  }
  return { current: choices.some(p => p.id === current) ? current : 'classic', choices }
}

export async function selectPersonality(dir: string, id: string) {
  await packAt(dir, id)
  const config = await readConfig(dir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeJson(join(dir, 'personality.json'), { ...config, persona: id })
  return { persona: id }
}

export async function savePreference(dir: string, input: Preference) {
  const entry = preferences({ schemaVersion: 1, preferences: [input] })[0]!
  const previous = await readJson(join(dir, 'preferences.json'), { schemaVersion: 1, preferences: [] })
  const memory = preferences(previous)
  const next = { schemaVersion: 1, preferences: [...memory.filter(p => p.id !== entry.id), entry] }
  preferences(next)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeJson(join(dir, 'preferences.previous.json'), previous)
  await writeJson(join(dir, 'preferences.json'), next)
  return next
}
