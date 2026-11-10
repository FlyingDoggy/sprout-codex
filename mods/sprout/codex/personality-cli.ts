import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listPersonalities, loadPersonality, savePreference, selectPersonality } from './personality-config'

export async function personalityCommand(dir: string, args: string[]) {
  const [action = 'show', value] = args
  if (action === 'use' && value) return selectPersonality(dir, value)
  if (action === 'list') return listPersonalities(dir)
  if (action === 'remember' && value) return savePreference(dir, JSON.parse(await readFile(value, 'utf8')))
  if (action !== 'show') throw new Error('Usage: personality-cli.ts show | list | use <id> | remember <entry.json>')
  const loaded = await loadPersonality(dir)
  return { persona: loaded.pack.id, name: loaded.pack.name, revision: loaded.revision, preferences: loaded.preferences }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await personalityCommand(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sprout'), process.argv.slice(2)), null, 2))
}
