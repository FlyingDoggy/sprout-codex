import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { GeneratedDialogueEngine } from '../generated-dialogue.ts'
import { generationSettings } from '../generation-config.ts'
import { codexDialogueArgs, codexDialogueProvider, dialoguePrompt } from '../dialogue-provider.ts'
import { readJson, selectPersonality, writeJson } from '../personality-config.ts'
import { DELIVERY_PERSONA } from '../personas.ts'
import { setLang } from '../../hooks/i18n.ts'
import type { LineChoice } from '../../hooks/host.ts'

setLang('zh')
const lines = ['叶子今天也在上班。', '这盆不接无效会议。', '我先把花盆扶稳。', '别拿返工当团建。', '废话浇不出新叶子。', '干完这单给我换盆。']
async function home(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sprout-generation-'))
  try { await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}
const configure = (dir: string, enabled = true, extra = {}) => writeJson(join(dir, 'personality.json'), { schemaVersion: 1, persona: 'delivery', generation: { enabled, minIntervalMs: 60_000, maxBatchesPerDay: 2, ...extra } })
const choice = (extra = {}): LineChoice => ({ text: '原版静态句', key: 'happy', moodKey: 'happy', now: Date.now(), today: '2026-11-10', index: 0, streak: 1, exhausted: false, original: () => ['原版静态句'], ...extra })
const task = { scenario: 'slides' as const, signals: ['artifact' as const], at: Date.now() }

test('generation defaults off; disabled engines neither call a provider nor consume old generated lines', () => home(async dir => {
  assert.equal(generationSettings(undefined).enabled, false)
  await configure(dir, false)
  await writeJson(join(dir, 'dialogue-cache.json'), { version: 1, day: '2026-11-10', count: 0, lastAttempt: 0, entries: [{ key: 'old', at: Date.now(), lines }] })
  let calls = 0
  const engine = new GeneratedDialogueEngine(dir, async () => { calls++; return { lines, elapsedMs: 1 } })
  await engine.prepare('a', task)
  for (let i = 0; i < 20; i++) assert.ok(!lines.includes(engine.chooseLine(choice({ index: i }))))
  await engine.settled()
  assert.equal(calls, 0)
}))

test('generation never blocks a drawing; cached lines stay with their chat and switch off immediately', () => home(async dir => {
  await configure(dir)
  let finish!: () => void, started!: () => void
  const begun = new Promise<void>(resolve => { started = resolve })
  const blocked = new Promise<void>(resolve => { finish = resolve })
  let calls = 0
  const engine = new GeneratedDialogueEngine(dir, async request => {
    calls++; assert.equal(request.task?.scenario, 'slides'); started(); await blocked
    return { lines, elapsedMs: 1 }
  })
  await engine.prepare('a', task)
  const immediate = engine.chooseLine(choice())
  assert.equal(typeof immediate, 'string'); assert.ok(!lines.includes(immediate))
  await begun; finish(); await engine.settled()
  await engine.prepare('a', task)
  assert.ok(lines.includes(engine.chooseLine(choice())))
  await engine.prepare('b', task)
  assert.ok(!lines.includes(engine.chooseLine(choice())))
  await engine.settled(); assert.equal(calls, 1)
  await configure(dir, false); await engine.prepare('a', task)
  assert.ok(!lines.includes(engine.chooseLine(choice())))
}))

test('quota exhaustion and shared daily reservations prevent extra calls across processes', () => home(async dir => {
  await configure(dir, true, { maxBatchesPerDay: 1 })
  let calls = 0
  const provider = async () => { calls++; return { lines, elapsedMs: 1 } }
  const a = new GeneratedDialogueEngine(dir, provider), b = new GeneratedDialogueEngine(dir, provider)
  await a.prepare('a', task); a.chooseLine(choice({ exhausted: true })); await a.settled()
  assert.equal(calls, 0)
  await b.prepare('b', task)
  a.chooseLine(choice()); b.chooseLine(choice())
  await Promise.all([a.settled(), b.settled()])
  assert.equal(calls, 1)
  const path = join(dir, 'dialogue-cache.json'), cache: any = await readJson(path, null)
  cache.lastAttempt = 0; await writeJson(path, cache)
  await b.prepare('c', task); b.chooseLine(choice()); await b.settled()
  assert.equal(calls, 1)
}))

test('a toggle or persona switch while generation runs discards the result', () => home(async dir => {
  for (const change of ['off', 'classic']) {
    await configure(dir)
    await rm(join(dir, 'dialogue-cache.json'), { force: true })
    let finish!: () => void, started!: () => void
    const begun = new Promise<void>(r => { started = r }), blocked = new Promise<void>(r => { finish = r })
    const engine = new GeneratedDialogueEngine(dir, async () => { started(); await blocked; return { lines, elapsedMs: 1 } })
    await engine.prepare('a', task); engine.chooseLine(choice()); await begun
    if (change === 'off') await configure(dir, false); else await selectPersonality(dir, 'classic')
    finish(); await engine.settled()
    assert.equal((await readJson<any>(join(dir, 'dialogue-cache.json'), null)).entries.length, 0)
  }
}))

test('provider failures fall back without retry storms, and preference provenance stays out of prompts', () => home(async dir => {
  await configure(dir)
  let calls = 0
  const engine = new GeneratedDialogueEngine(dir, async () => { calls++; throw new Error('fake timeout') })
  await engine.prepare('a', task); const before = engine.chooseLine(choice()); await engine.settled()
  await engine.prepare('a', task); assert.equal(engine.chooseLine(choice()), before); await engine.settled()
  assert.equal(calls, 1)
  const prompt = dialoguePrompt({ pack: DELIVERY_PERSONA, preferences: [{ id: 'one', text: '保留母版', scopes: ['slides'], source: '/PRIVATE/path', updatedAt: '2026-11-10' }], task, bucket: 'happy', examples: [], recent: [] })
  assert.match(prompt, /保留母版/); assert.doesNotMatch(prompt, /PRIVATE|updatedAt|"source"/)
}))

test('the CLI provider uses an isolated directory and disabled tools; a local fake executable verifies the protocol', () => home(async dir => {
  const binary = join(dir, 'fake-codex'), capture = join(dir, 'capture.json')
  await writeFile(binary, `#!/usr/bin/env node
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args, cwd:process.cwd()}));
fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({lines:${JSON.stringify(lines)}}));
process.stdin.resume(); process.stdin.on('end',()=>{ console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:20}})) });
`, { mode: 0o700 })
  const provider = codexDialogueProvider(binary, dir)
  const result = await provider({ pack: DELIVERY_PERSONA, preferences: [], task, bucket: 'happy', examples: [], recent: [] }, generationSettings({ enabled: true }))
  assert.deepEqual(result.lines, lines); assert.equal(result.usage?.input_tokens, 100)
  const run = JSON.parse(await readFile(capture, 'utf8'))
  assert.notEqual(run.cwd, dir)
  await assert.rejects(readFile(join(run.cwd, 'system.md')))
  assert.ok(run.args.includes('--ignore-user-config')); assert.ok(run.args.includes('--ephemeral'))
  assert.ok(run.args.includes('forced_login_method="chatgpt"')); assert.ok(run.args.includes('read-only'))
  const args = codexDialogueArgs('/empty', 'model')
  for (const feature of ['shell_tool', 'apps', 'plugins', 'memories', 'hooks', 'browser_use', 'multi_agent']) assert.ok(args.some((a, i) => a === '--disable' && args[i + 1] === feature))
}))
