import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DELIVERY_PERSONA, personaPools } from '../src/core/personality'
import { companion } from '../src/core/companion'
import { classifyTask } from '../src/server/task-context'
import { consumeActivity, freshActivity } from '../src/server/activity'
import { DialogueEngine } from '../src/server/dialogue'
import { loadPersonality, listPersonalities, savePreference, validDialogue } from '../src/server/personality-config'
import { personalityCommand } from '../src/server/personality-cli'
import { readJson, writeJson } from '../src/server/storage'
import { demoDashboard } from '../src/server/demo'

async function setup(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'sprout-personality-test-'))
  try { await run(dir) } finally { await rm(dir,{ recursive:true,force:true }) }
}
const configure = (dir: string, enabled = false) => writeJson(join(dir,'personality.json'), { schemaVersion:1,persona:'delivery',generation:{enabled} })

test('delivery lines fit the unchanged bubble and distinguish deliverables from coding', () => {
  for (const group of [DELIVERY_PERSONA.pools, DELIVERY_PERSONA.scenes, DELIVERY_PERSONA.signals]) {
    for (const lines of Object.values(group)) for (const line of lines) assert.ok(validDialogue(line),line)
  }
  assert.deepEqual(personaPools(DELIVERY_PERSONA,{scenario:'slides',signals:[],at:0}).planning,[...DELIVERY_PERSONA.scenes.slides!, ...DELIVERY_PERSONA.pools.planning!])
  assert.doesNotMatch(personaPools(DELIVERY_PERSONA,{scenario:'consulting',signals:[],at:0}).planning!.join(''),/代码呢/)
  const contextual = personaPools(DELIVERY_PERSONA,{scenario:'slides',signals:['layout','review'],at:0}).happy!
  for (const line of [...DELIVERY_PERSONA.signals.layout!, ...DELIVERY_PERSONA.signals.review!, ...DELIVERY_PERSONA.scenes.slides!, ...DELIVERY_PERSONA.pools.happy!]) assert.ok(contextual.includes(line))
  assert.equal(new Set(contextual).size, contextual.length)
})

test('a custom persona keeps the original streak rotation instead of hiding its streak lines', () => {
  const now=Date.parse('2026-11-10T04:00:00Z'), d=demoDashboard(now)
  d.quota.windows=[]
  d.pet={ fed:0,patted:0,highest:1,action:null,actionAt:0 }
  d.dialogue={personaId:'delivery',revision:'test',pools:DELIVERY_PERSONA.pools}
  const expected=[...DELIVERY_PERSONA.pools.happy!,...DELIVERY_PERSONA.pools.streak!]
  assert.ok(companion(d,now).streak>=7)
  for(let index=0;index<expected.length;index++){
    d.pet.line={bucket:'happy',index,at:now}
    assert.equal(companion(d,now).text,expected[index])
  }
})

test('current user turns change task labels without retaining their content', () => {
  const state=freshActivity(), at=Date.now()
  const send=(message:string,offset=0)=>consumeActivity(state,{timestamp:new Date(at+offset).toISOString(),type:'event_msg',payload:{type:'user_message',message}})
  send('只改第 3 页 PPT，保留母版。PRIVATE CLIENT 1234')
  assert.equal(state.task?.scenario,'slides'); assert.ok(state.task?.signals.includes('layout'))
  send('可以',1); assert.equal(state.task?.scenario,'slides')
  send('现在修代码里的 bug，运行单元测试',2); assert.equal(state.task?.scenario,'coding')
  assert.doesNotMatch(JSON.stringify(state),/PRIVATE|1234|第 3 页|单元测试/)
  assert.equal(classifyTask('没听懂，给我讲解这个课程',at).scenario,'teaching')
})

test('persona and sourced preferences hot-reload; memory metadata stays out of dashboards', async () => setup(async dir => {
  await configure(dir)
  await mkdir(join(dir,'personas'))
  await writeJson(join(dir,'personas','tester.json'),{schemaVersion:1,id:'tester',version:'1',extends:'delivery',name:'测试搭子',pools:{happy:['我在看稿，你别发呆。','花盆坐稳了，开工。']}})
  await personalityCommand(dir,['use','tester'])
  const before=await loadPersonality(dir)
  const preference={id:'plain',text:'中文说人话，不写AI腔。',scopes:[] as [],source:'PRIVATE_SOURCE',updatedAt:'2026-11-10'}
  await savePreference(dir,preference)
  const after=await loadPersonality(dir)
  assert.notEqual(after.revision,before.revision)
  const d=await new DialogueEngine(dir).decorate(demoDashboard())
  assert.doesNotMatch(JSON.stringify(d),/PRIVATE_SOURCE|中文说人话/)
  const midday=Date.parse('2026-11-10T04:00:00Z')
  d.pet.line={bucket:'happy',index:0,at:midday}
  assert.ok(after.pack.pools.happy!.includes(companion(d,midday).text))
  await writeFile(join(dir,'personas','broken.json'),'{"id":"broken"}')
  await assert.rejects(personalityCommand(dir,['use','broken']))
  assert.equal((await loadPersonality(dir)).pack.id,'tester')
}))

test('menu lists validated local packs without reading or exposing private preferences', async () => setup(async dir => {
  await writeJson(join(dir,'personas','tester.json'),{schemaVersion:1,id:'tester',version:'1',name:'测试搭子',identity:'PRIVATE IDENTITY',pools:{happy:['台词甲。','台词乙。']}})
  await writeFile(join(dir,'personas','broken.json'),'{broken')
  await writeJson(join(dir,'personas','mismatch.json'),{schemaVersion:1,id:'another',version:'1',name:'冒牌'})
  await writeJson(join(dir,'personas','classic.json'),{schemaVersion:1,id:'classic',version:'1',name:'替换内置'})
  await writeFile(join(dir,'preferences.json'),'{private and invalid')
  await personalityCommand(dir,['use','tester'])
  assert.deepEqual(await listPersonalities(dir),{current:'tester',choices:[{id:'classic',name:'原版小苗'},{id:'delivery',name:'交付搭子'},{id:'tester',name:'测试搭子'}]})
  const before = await readJson(join(dir,'personality.json'),null)
  await assert.rejects(personalityCommand(dir,['use','../tester']))
  assert.deepEqual(await readJson(join(dir,'personality.json'),null),before)
}))
