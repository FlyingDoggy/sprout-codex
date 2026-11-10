import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DialogueEngine } from '../dialogue.ts'
import { DELIVERY_PERSONA, taskLinesFor } from '../personas.ts'
import type { TaskScenario } from '../personas.ts'
import { loadPersonality, listPersonalities, parsePersona, selectPersonality, savePreference, validDialogue, writeJson } from '../personality-config.ts'
import { consumeRecord, freshSession } from '../activity.ts'
import { addCodexLines } from '../lines.ts'
import { linesFor } from '../../hooks/lines.ts'
import type { LineContext } from '../../hooks/lines.ts'
import type { LineChoice } from '../../hooks/host.ts'
import { setLang } from '../../hooks/i18n.ts'

addCodexLines()
setLang('zh')
async function home(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sprout-personality-'))
  try { await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}
const configure = (dir: string, persona = 'delivery') => writeJson(join(dir, 'personality.json'), { schemaVersion: 1, persona, generation: { enabled: false, model: 'kept' } })
function choice(key = 'happy', now = Date.now()): LineChoice {
  const context = { fed: 2, patted: 3, streak: 8, level: 'Lv2', time: '23:10', agents: 2 } as unknown as LineContext
  return { text: '原版回复', key: key as LineChoice['key'], moodKey: key as LineChoice['key'], index: 0, now, streak: 8, original: bucket => linesFor([bucket], context).map(line => line.text) }
}

test('all delivery lines fit the original bubble; invalid packs cannot select paths or markup', () => {
  for (const group of [DELIVERY_PERSONA.pools, DELIVERY_PERSONA.scenes, DELIVERY_PERSONA.signals]) for (const lines of Object.values(group)) for (const line of lines) assert.ok(validDialogue(line), line)
  const pack = { schemaVersion: 1, id: 'local', extends: 'delivery', version: '1', name: '本地' }
  assert.equal(parsePersona(pack, 'local').inheritOriginal, true)
  assert.throws(() => parsePersona({ ...pack, id: '../local' }, '../local'))
  assert.throws(() => parsePersona({ ...pack, pools: { happy: ['<script>', '行'] } }, 'local'))
})

test('only real user requests classify a chat, without retaining prompt or attachment contents', () => {
  const state = freshSession(), now = Date.now()
  const send = (text: string, ms = 0, role = 'user') => consumeRecord(state, { type: 'response_item', timestamp: new Date(now + ms).toISOString(), payload: { type: 'message', role, content: [{ type: 'input_text', text }] } })
  send('# Files mentioned by the user:\nPRIVATE.ts\n## My request:\n只改第 3 页 PPT，保留母版。<image name="x">代码 bug</image>')
  assert.equal(state.task?.scenario, 'slides'); assert.deepEqual(state.task?.signals, ['layout'])
  send('<environment_context>代码 bug npm</environment_context>', 1)
  send('修复代码 bug', 2, 'assistant')
  send('可以，继续', 3)
  assert.equal(state.task?.scenario, 'slides'); assert.deepEqual(state.task?.signals, ['layout'])
  send('输出可编辑的 PPT', 4)
  assert.ok(state.task?.signals.includes('artifact'))
  send('现在出不含税的报价单，核对角色和工时', 5)
  assert.equal(state.task?.scenario, 'commercial')
  send('PPT 母版', 0)
  assert.equal(state.task?.scenario, 'commercial')
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE|报价单|第 3 页|<image/)
})

test('24 manual roasts remain varied, retain original banter and follow work under quota and night moods', () => home(async dir => {
  await configure(dir)
  const engine = new DialogueEngine(dir)
  for (const scenario of ['slides', 'consulting', 'commercial', 'research', 'teaching', 'coding', 'media'] as TaskScenario[]) {
    for (const mood of ['happy', 'worry', 'sleep', 'night']) {
      const now = Date.now(), task = { scenario, signals: [], at: now }
      await engine.prepare(`${scenario}/${mood}`, task)
      const tasks = taskLinesFor(DELIVERY_PERSONA, task), seen: string[] = []
      for (let i = 0; i < 24; i++) {
        await engine.press('roast', mood, now + i)
        const line = engine.chooseLine(choice(mood, now + i))
        if (i % 3 !== 2) assert.ok(tasks.includes(line), `${scenario}/${mood}: ${line}`)
        seen.push(line)
      }
      assert.equal(new Set(seen).size, 24, `${scenario}/${mood}`)
      assert.ok(seen.includes('又来上班？行，今天的 token 我替你烧。'))
    }
  }
}))

test('water and pat cannot trap the roast; hot switching and process restarts preserve rotation and settings', () => home(async dir => {
  await configure(dir)
  await mkdir(join(dir, 'personas'))
  await writeJson(join(dir, 'personas/local.json'), { schemaVersion: 1, id: 'local', extends: 'delivery', name: '本地搭子', version: '1' })
  const now = Date.now(), task = { scenario: 'slides' as const, signals: [], at: now }
  const engine = new DialogueEngine(dir)
  await engine.prepare('one', task)
  await engine.press('roast', 'worry', now)
  assert.equal(engine.chooseLine(choice('worry', now)), DELIVERY_PERSONA.scenes.slides![0])
  await engine.press('feed', 'feed', now + 1)
  assert.equal(engine.chooseLine(choice('feed', now + 1)), DELIVERY_PERSONA.pools.feed![0])
  await engine.press('pat', 'pat', now + 2)
  assert.equal(engine.chooseLine(choice('pat', now + 2)), DELIVERY_PERSONA.pools.pat![0])
  await engine.press('roast', 'worry', now + 3)
  assert.equal(engine.chooseLine(choice('worry', now + 3)), DELIVERY_PERSONA.scenes.slides![1])
  await selectPersonality(dir, 'local'); await engine.prepare('one', task)
  await engine.press('roast', 'happy', now + 4)
  assert.equal(engine.chooseLine(choice('happy', now + 4)), DELIVERY_PERSONA.scenes.slides![0])
  await selectPersonality(dir, 'delivery')
  const restarted = new DialogueEngine(dir); await restarted.prepare('one', task)
  await restarted.press('roast', 'sleep', now + 5)
  assert.equal(restarted.chooseLine(choice('sleep', now + 5)), '又来上班？行，今天的 token 我替你烧。')
  const config = JSON.parse(await readFile(join(dir, 'personality.json'), 'utf8'))
  assert.deepEqual(config.generation, { enabled: false, model: 'kept' })
  await assert.rejects(selectPersonality(dir, '../wrong'))
  assert.equal((await loadPersonality(dir)).pack.id, 'delivery')
  await savePreference(dir, { id: 'style', text: '短句', source: 'local-only-source', updatedAt: '2026-11-10', scopes: ['slides'] })
  assert.doesNotMatch(JSON.stringify(await listPersonalities(dir)), /local-only-source|短句/)
  await writeFile(join(dir, 'personas/broken.json'), '{')
  assert.equal((await listPersonalities(dir)).choices.length, 3)
  await writeFile(join(dir, 'personality.json'), '{')
  await restarted.prepare('one', task)
  assert.equal(restarted.chooseLine(choice()), '原版回复')
}))
