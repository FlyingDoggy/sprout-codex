import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPersonality, parsePersona, personalityConfigSchema, savePreference } from './personality-config'
import { readJson, writeJson } from './storage'

/** Explicit local management; never enable a provider as a side effect of selecting a persona. */
export async function personalityCommand(dataDir: string, args: string[]) {
  const [action = 'show', value] = args
  if (action === 'remember' && value) {
    const memory = await savePreference(dataDir, JSON.parse(await readFile(value, 'utf8')))
    return { preferences:memory.preferences.length, updated:true }
  }
  if (action === 'use' && value || action === 'generation' && ['on','off'].includes(value)) {
    const path = join(dataDir, 'personality.json')
    const previous = personalityConfigSchema.parse(await readJson(path, {}))
    const config = personalityConfigSchema.parse(action === 'use' ? { ...previous, persona:value } : { ...previous, generation:{ ...previous.generation, enabled:value === 'on' } })
    // Validate a candidate pack before changing the selection.
    if (action === 'use' && !['classic','delivery'].includes(value)) {
      parsePersona(JSON.parse(await readFile(join(dataDir, 'personas', `${config.persona}.json`), 'utf8')), config.persona)
    }
    await writeJson(path, config)
    return { persona:config.persona, generation:config.generation.enabled }
  }
  if (action !== 'show') throw new Error('Usage: personality show | use <id> | generation <on|off> | remember <entry.json>')
  const loaded = await loadPersonality(dataDir)
  return { persona:loaded.pack.id, name:loaded.pack.name, revision:loaded.revision, generation:loaded.config.generation,
    preferences:loaded.preferences, status:await readJson(join(dataDir,'dialogue-status.json'),null) }
}
