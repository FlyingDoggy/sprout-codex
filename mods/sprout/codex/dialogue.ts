import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LineChoice } from '../hooks/host'
import { lang } from '../hooks/i18n'
import { CLASSIC_PERSONA, interleave, personaPools, taskLinesFor } from './personas'
import type { LinePools, TaskContext } from './personas'
import { loadPersonality, readJson, writeJson } from './personality-config'
import type { Action } from './pet'

type Press = { key: string; persona: string; revision: string; mode: Action; bucket: string; index: number; at: number }
type State = { cursors: Record<string, number>; last: Record<string, Press> }
const fresh = (): State => ({ cursors: {}, last: {} })
const CODING = /代码|测试|重构|合并|提交|上线|\b(?:bugs?|commit|git|squash|debug|node_modules|rebase|CI|TODOs?|force[- ]?push|coding|code|tests?|refactor|main)\b/i

export class DialogueEngine {
  readonly dataDir: string
  protected loaded?: Awaited<ReturnType<typeof loadPersonality>>
  protected task?: TaskContext
  protected thread = 'global'
  protected generated: LinePools = {}
  private state: State = fresh()

  constructor(dataDir: string) { this.dataDir = dataDir }

  async prepare(thread = 'global', task?: TaskContext) {
    this.thread = thread
    this.task = task
    this.generated = {}
    try { this.loaded = await loadPersonality(this.dataDir) } catch { this.loaded = undefined }
    try {
      const state = await readJson(join(this.dataDir, 'store/persona-dialogue.json'), fresh())
      this.state = state && state.cursors && state.last ? state : fresh()
    } catch { this.state = fresh() }
  }

  async press(mode: Action, bucket: string, now = Date.now()) {
    const pack = this.loaded?.pack ?? CLASSIC_PERSONA
    const taskKey = `${this.task?.scenario ?? 'general'}:${[...this.task?.signals ?? []].sort().join(',')}`
    const key = `${this.thread}/${pack.id}/${mode === 'roast' ? `roast/${taskKey}` : `care/${bucket}`}`
    const index = (Number.isSafeInteger(this.state.cursors[key]) ? this.state.cursors[key]! : -1) + 1
    const lastKey = `${this.thread}/${pack.id}`
    this.state.cursors = Object.fromEntries([...Object.entries(this.state.cursors).filter(([k]) => k !== key), [key, index]].slice(-256))
    this.state.last = Object.fromEntries([...Object.entries(this.state.last).filter(([k]) => k !== lastKey), [lastKey, { key, persona: pack.id, revision: this.loaded?.revision ?? '', mode, bucket, index, at: now }]].slice(-128))
    await mkdir(join(this.dataDir, 'store'), { recursive: true, mode: 0o700 })
    await writeJson(join(this.dataDir, 'store/persona-dialogue.json'), this.state)
  }

  chooseLine(choice: LineChoice) {
    const pack = this.loaded?.pack ?? CLASSIC_PERSONA
    if ((pack.id === 'classic' && !Object.values(this.generated).some(lines => lines?.length)) || lang() !== 'zh') return choice.text
    const pools = personaPools(pack, this.task)
    const original = (key: string) => choice.original(key as LineChoice['key']).filter(text =>
      !pack.inheritOriginal || this.task?.scenario === 'coding' || ['test_failed', 'test_passed', 'party'].includes(key) || !CODING.test(text))
    const resolve = (key: string) => {
      const custom = interleave([this.generated[key as keyof LinePools] ?? [], pools[key as keyof LinePools] ?? []])
      return custom.length ? (pack.inheritOriginal || pack.id === 'classic' ? interleave([custom, original(key)]) : custom) : original(key)
    }
    const pressed = this.state.last[`${this.thread}/${pack.id}`]
    const taskKey = `${this.task?.scenario ?? 'general'}:${[...this.task?.signals ?? []].sort().join(',')}`
    const live = pressed && pressed.revision === this.loaded?.revision && choice.now >= pressed.at && choice.now - pressed.at < 5 * 60_000 &&
      (pressed.mode !== 'roast' || pressed.key.endsWith(`/roast/${taskKey}`))
    const index = live ? pressed.index : choice.index
    const key = live ? pressed.bucket : choice.key
    let lines = resolve(key)
    if (live && pressed.mode === 'roast') {
      const tasks = taskLinesFor(pack, this.task)
      const taskSet = new Set(tasks)
      const aside = interleave([
        ...(pack.inheritOriginal ? [original('happy')] : []),
        resolve('happy').filter(line => !taskSet.has(line)),
        key === 'happy' ? [] : resolve(key).filter(line => !taskSet.has(line)),
        choice.streak >= 7 ? resolve('streak') : [],
      ]).filter(line => !taskSet.has(line))
      if (tasks.length && (!aside.length || index % 3 !== 2)) {
        const position = aside.length ? index - Math.floor((index + 1) / 3) : index
        return tasks[position % tasks.length]!
      }
      if (aside.length) return aside[(tasks.length ? Math.floor(index / 3) : index) % aside.length]!
    }
    if (key === 'happy' && choice.streak >= 7) lines = [...new Set([...lines, ...resolve('streak')])]
    return lines[index % lines.length] ?? choice.text
  }
}
