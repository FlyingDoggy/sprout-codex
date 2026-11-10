import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DELIVERY_PERSONA } from '../src/core/personality'
import { DialogueEngine } from '../src/server/dialogue'
import { dialoguePrompt, codexDialogueArgs } from '../src/server/dialogue-provider'
import { loadPersonality, validDialogue } from '../src/server/personality-config'
import { readJson, writeJson } from '../src/server/storage'
import { demoDashboard } from '../src/server/demo'

async function setup(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'sprout-dialogue-test-'))
  try { await run(dir) } finally { await rm(dir,{ recursive:true,force:true }) }
}
const configure = (dir: string, enabled = false) => writeJson(join(dir,'personality.json'), { schemaVersion:1,persona:'delivery',generation:{enabled} })
const generated = ['方案改完了，我这片叶子也快秃了。', '你盯交付，我替你盯着花盆。', '这公司开到半夜，连花都要上班。']

test('default and OFF never call a model or show cached generated dialogue', async () => setup(async dir => {
  const defaults=await loadPersonality(dir)
  assert.equal(defaults.config.generation.enabled,false); assert.equal(defaults.pack.id,'classic')
  const d=demoDashboard(); let calls=0
  const engine=new DialogueEngine(dir,async()=>{calls++;return {lines:generated,elapsedMs:1}})
  await configure(dir)
  assert.equal((await engine.decorate(d)).dialogue?.personaId,'delivery')
  await engine.settled(); assert.equal(calls,0)
  await configure(dir,true)
  await engine.decorate(d,'happy'); await engine.settled(); assert.equal(calls,1)
  assert.deepEqual((await engine.decorate(d,'happy')).dialogue?.pools.happy,generated)
  await configure(dir,false)
  assert.deepEqual((await engine.decorate(d,'happy')).dialogue?.pools.happy,DELIVERY_PERSONA.pools.happy)
  await engine.settled(); assert.equal(calls,1)
}))

test('model work never blocks display, and toggling off discards an in-flight result', async () => setup(async dir => {
  await configure(dir,true)
  let release!:()=>void, started!:()=>void
  const running=new Promise<void>(resolve=>{started=resolve})
  const gate=new Promise<void>(resolve=>{release=resolve})
  const engine=new DialogueEngine(dir,async()=>{started();await gate;return {lines:generated,elapsedMs:100}})
  const d=await engine.decorate(demoDashboard(),'happy')
  assert.deepEqual(d.dialogue?.pools.happy,DELIVERY_PERSONA.pools.happy)
  await running; await configure(dir,false); release(); await engine.settled()
  const cache=await readJson<any>(join(dir,'dialogue-cache.json'),null)
  assert.equal(cache.entries.length,0)
}))

test('multiple MCP instances share generation reservations and isolate chat caches', async () => setup(async dir => {
  await configure(dir,true); let calls=0
  const provider=async()=>{calls++;return {lines:generated,elapsedMs:1}}
  const first=new DialogueEngine(dir,provider),second=new DialogueEngine(dir,provider)
  const d={...demoDashboard(),context:{threadId:'one'}}
  await Promise.all([first.decorate(d,'happy'),second.decorate(d,'happy')]); await Promise.all([first.settled(),second.settled()])
  assert.equal(calls,1)
  assert.deepEqual((await second.decorate(d,'happy')).dialogue?.pools.happy,generated)
  const other=await second.decorate({...d,context:{threadId:'two'}},'happy'); await second.settled()
  assert.deepEqual(other.dialogue?.pools.happy,DELIVERY_PERSONA.pools.happy); assert.equal(calls,1)
}))

test('bad output and provider failures fall back without retries on every poll', async () => setup(async dir => {
  await configure(dir,true);let calls=0
  const engine=new DialogueEngine(dir,async()=>{calls++;throw new Error('private error')})
  for(let i=0;i<3;i++){ const d=await engine.decorate(demoDashboard(),'happy');await engine.settled();assert.deepEqual(d.dialogue?.pools.happy,DELIVERY_PERSONA.pools.happy) }
  assert.equal(calls,1)
  const status=await readJson<any>(join(dir,'dialogue-status.json'),null)
  assert.equal(status.ok,false);assert.doesNotMatch(JSON.stringify(status),/private error/)
  assert.equal(validDialogue('<script>alert(1)</script>'),false)
  assert.equal(validDialogue('胡说'.repeat(40)),false)
}))

test('Codex provider uses subscription auth, ephemeral read-only runs and disables plugin recursion', () => {
  const args=codexDialogueArgs('/tmp/sprout-test','gpt-6-luna')
  for(const flag of ['--ignore-user-config','--ephemeral','forced_login_method="chatgpt"','web_search="disabled"','read-only','--output-schema']) assert.ok(args.includes(flag))
  for(const feature of ['plugins','apps','shell_tool','multi_agent','hooks']) assert.ok(args.some((arg,i)=>arg==='--disable'&&args[i+1]===feature))
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'),false)
})


test('generation receives relevant preference text without its private source metadata', () => {
  const preference={id:'plain',text:'中文说人话，不写AI腔。',scopes:[] as [],source:'PRIVATE_SOURCE',updatedAt:'2026-11-10'}
  const prompt=dialoguePrompt({pack:DELIVERY_PERSONA,preferences:[preference],bucket:'happy',examples:[],recent:[]})
  assert.match(prompt,/中文说人话/)
  assert.doesNotMatch(prompt,/PRIVATE_SOURCE/)
})

test('a dialogue engine without a provider stays static even when generation is enabled', async () => setup(async dir => {
  await configure(dir,true)
  const engine=new DialogueEngine(dir)
  const d=await engine.decorate(demoDashboard())
  await engine.settled()
  assert.deepEqual(d.dialogue?.pools.happy,DELIVERY_PERSONA.pools.happy)
  assert.equal(await readJson(join(dir,'dialogue-cache.json'),null),null)
}))
