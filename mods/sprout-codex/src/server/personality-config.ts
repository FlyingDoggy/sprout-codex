import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CLASSIC_PERSONA, DELIVERY_PERSONA, TASK_SCENARIOS, TASK_SIGNALS, type PersonaPack, type PersonalityMenu } from '../core/personality'
import { LINES } from '../core/lines'
import { wrapText } from '../core/logic'
import { writeJson } from './storage'

export function validDialogue(text: string) {
  return text.trim().length > 0 && text.length <= 100 && !/[<>\n\r\u0000-\u001f]|\{\w+\}/.test(text) && !wrapText(text, 11, 3).isCut
}
const sentence = z.string().refine(validDialogue, '台词必须能完整放入原版三行气泡。')
const lines = z.array(sentence).min(2).max(40)
const pools = z.record(z.string(), lines).refine(value => Object.keys(value).every(key => key in LINES), '未知台词场景。')
const packSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z0-9_-]{1,60}$/), version: z.string().min(1).max(40),
  extends: z.enum(['classic', 'delivery']).default('classic'), name: z.string().min(1).max(80),
  identity: z.string().max(1200).optional(), voice: z.array(z.string().max(500)).max(16).optional(),
  inheritOriginal: z.boolean().optional(),
  pools: pools.default({}), scenes: z.partialRecord(z.enum(TASK_SCENARIOS), lines).default({}),
  signals: z.partialRecord(z.enum(TASK_SIGNALS), lines).default({}),
}).strict()

export function parsePersona(input: unknown, id: string): PersonaPack {
  const custom = packSchema.parse(input)
  if (custom.id !== id) throw new Error('人设文件名与 id 不一致。')
  const base = custom.extends === 'delivery' ? DELIVERY_PERSONA : CLASSIC_PERSONA
  return { ...base, ...custom, inheritOriginal:custom.inheritOriginal ?? base.inheritOriginal, identity:custom.identity ?? base.identity, voice:custom.voice ?? base.voice,
    pools:{ ...base.pools, ...custom.pools }, scenes:{ ...base.scenes, ...custom.scenes }, signals:{ ...base.signals, ...custom.signals } } as PersonaPack
}

export const personalityConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1), persona: z.string().regex(/^[a-z0-9_-]{1,60}$/).default('classic'),
  generation: z.object({
    enabled: z.boolean().default(false), provider: z.literal('codex').default('codex'),
    model: z.string().min(1).max(100).default('gpt-6-luna'), binary: z.string().min(1).optional(),
    minIntervalMs: z.number().int().min(60_000).max(86_400_000).default(15 * 60_000),
    maxBatchesPerDay: z.number().int().min(1).max(100).default(12),
    timeoutMs: z.number().int().min(1000).max(60_000).default(45_000),
  }).default({ enabled: false, provider: 'codex', model: 'gpt-6-luna', minIntervalMs: 900_000, maxBatchesPerDay: 12, timeoutMs: 45_000 }),
}).strict()
export type PersonalityConfig = z.infer<typeof personalityConfigSchema>
export const preferenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,80}$/), text: z.string().min(1).max(400),
  scopes: z.array(z.enum(TASK_SCENARIOS)).max(TASK_SCENARIOS.length).default([]),
  source: z.string().min(1).max(600), updatedAt: z.string().min(1).max(40),
}).strict()
export const memorySchema = z.object({ schemaVersion: z.literal(1), preferences: z.array(preferenceSchema).max(40) }).strict()
export type Preference = z.infer<typeof preferenceSchema>

async function jsonOrMissing(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
}
export async function loadPersonality(dataDir: string) {
  const config = personalityConfigSchema.parse(await jsonOrMissing(join(dataDir, 'personality.json')) ?? {})
  let pack = config.persona === 'delivery' ? DELIVERY_PERSONA : CLASSIC_PERSONA
  if (!['classic', 'delivery'].includes(config.persona)) {
    pack = parsePersona(await jsonOrMissing(join(dataDir, 'personas', `${config.persona}.json`)), config.persona)
  }
  const memory = memorySchema.parse(await jsonOrMissing(join(dataDir, 'preferences.json')) ?? { schemaVersion: 1, preferences: [] })
  const revision = createHash('sha256').update(JSON.stringify([pack, memory])).digest('hex').slice(0,24)
  return { config, pack, preferences: memory.preferences, revision }
}

/** Only display names and ids cross into the settings menu, never private preferences. */
export async function listPersonalities(dataDir: string): Promise<PersonalityMenu> {
  const config = personalityConfigSchema.parse(await jsonOrMissing(join(dataDir, 'personality.json')) ?? {})
  const choices = [CLASSIC_PERSONA, DELIVERY_PERSONA].map(({ id, name }) => ({ id, name }))
  let files: string[] = []
  try { files = await readdir(join(dataDir, 'personas')) }
  catch (error: any) { if (error.code !== 'ENOENT') throw error }
  for (const file of files.sort()) {
    const match = /^([a-z0-9_-]{1,60})\.json$/.exec(file)
    if (!match || choices.some(p => p.id === match[1])) continue
    try {
      const { id, name } = parsePersona(await jsonOrMissing(join(dataDir, 'personas', file)), match[1])
      choices.push({ id, name })
    } catch { /* A broken optional pack must not hide the working choices. */ }
  }
  return { current: choices.some(p => p.id === config.persona) ? config.persona : 'classic', choices }
}

export async function savePreference(dataDir: string, input: Preference) {
  const entry = preferenceSchema.parse(input)
  const previous = memorySchema.parse(await jsonOrMissing(join(dataDir, 'preferences.json')) ?? { schemaVersion: 1, preferences: [] })
  const next = memorySchema.parse({ ...previous, preferences: [...previous.preferences.filter(p => p.id !== entry.id), entry] })
  await writeJson(join(dataDir, 'preferences.previous.json'), previous)
  await writeJson(join(dataDir, 'preferences.json'), next)
  return next
}
