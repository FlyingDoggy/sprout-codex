import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DELIVERY_PERSONA, personaPools, taskLinesFor, type TaskScenario } from '../src/core/personality'
import { companion, interactPet } from '../src/core/companion'
import { classifyTask } from '../src/server/task-context'
import { consumeActivity, freshActivity } from '../src/server/activity'
import { DialogueEngine } from '../src/server/dialogue'
import { loadPersonality, listPersonalities, parsePersona, savePreference, validDialogue } from '../src/server/personality-config'
import { personalityCommand } from '../src/server/personality-cli'
import { readJson, writeJson } from '../src/server/storage'
import { demoDashboard } from '../src/server/demo'
import { consumeLine, freshScan } from '../src/server/usage'

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

test('desktop user records reach the classifier; injected instructions, images and assistant output do not', () => {
  const scan=freshScan(), at=Date.now()
  const desktop=(text:string, offset=0, role='user')=>consumeLine(scan,JSON.stringify({type:'response_item',timestamp:new Date(at+offset).toISOString(),payload:{type:'message',role,content:[{type:'input_text',text}]}}))
  consumeActivity(scan.activity,{type:'event_msg',timestamp:new Date(at+100).toISOString(),payload:{type:'task_started',turn_id:'turn'}})
  desktop('# Files mentioned by the user:\nPRIVATE-CODE.ts\n## My request:\n只改第 3 页 PPT，保留母版。\n<image name="example">PRIVATE IMAGE TEXT</image>')
  assert.equal(scan.activity.task?.scenario,'slides')
  assert.deepEqual(scan.activity.task?.signals,['layout'])
  desktop('# AGENTS.md instructions for /PRIVATE\n<INSTRUCTIONS>代码 bug npm API</INSTRUCTIONS>',1)
  desktop('<environment_context>代码 bug npm API</environment_context>',2)
  desktop('现在修代码里的 bug，运行单元测试',3,'assistant')
  assert.equal(scan.activity.task?.at,at)
  desktop('可以，继续',4)
  assert.deepEqual(scan.activity.task?.signals,['layout'])
  desktop('改 wording，少写废话',5)
  assert.equal(scan.activity.task?.scenario,'slides')
  assert.deepEqual(scan.activity.task?.signals,['wording'])
  desktop('现在出不含税的报价单，核对角色和工时',6)
  assert.equal(scan.activity.task?.scenario,'commercial')
  assert.deepEqual(scan.activity.task?.signals,[])
  desktop('PPT 母版',0)
  assert.equal(scan.activity.task?.scenario,'commercial','out-of-order copies cannot restore an older task')
  assert.doesNotMatch(JSON.stringify(scan),/PRIVATE|报价单|wording，|CODE\.ts/)
})

test('actual deliverable vocabulary selects specific scenes without classifying framework names as coding', () => {
  const at=Date.now()
  assert.equal(classifyTask('完了，更懵了，感觉你越讲我越晕，你能从发展阶段来讲吗',at).scenario,'teaching')
  assert.equal(classifyTask('LangChain 跟 LangGraph 的关系我还是没搞清楚',at).scenario,'teaching')
  assert.deepEqual(classifyTask('对齐三类架构的职责和边界',at).signals,['architecture'])
  assert.deepEqual(classifyTask('梳理 Wiki 与 Ontology 分享方案',at).signals,['knowledge'])
  assert.deepEqual(classifyTask('更新这一页的 pptx，输出完整新材料',at).signals,['artifact'])
  assert.deepEqual(classifyTask('再嘴一句只有四句台词，喂水后还串台',at).signals,['dialogue'])
  assert.deepEqual(classifyTask('直接推送，别反复问我确认',at).signals,['autonomy'])
})

test('delivery roasts keep task relevance and original lines even during quota worry, sleep and night', () => {
  for (const scenario of ['slides','consulting','commercial','research','teaching','coding','media'] as TaskScenario[]) {
    for (const mood of ['happy','worry','sleep','night']) {
      const now=Date.parse(mood==='night' ? '2026-11-09T18:00:00Z' : '2026-11-10T04:00:00Z'), d=demoDashboard(now)
      d.task={scenario,signals:[],at:now}
      d.activity=undefined
      d.pet={fed:3,patted:4,highest:1,action:null,actionAt:0}
      for(const w of d.quota.windows) { w.usedPercent=mood==='sleep'?100:mood==='worry'?95:0; w.projected=null }
      const taskLines=taskLinesFor(DELIVERY_PERSONA,d.task)
      d.dialogue={personaId:'delivery',revision:'test',pools:personaPools(DELIVERY_PERSONA,d.task),inheritOriginal:true,taskLines}
      const seen:string[]=[]
      for(let i=0;i<24;i++) {
        d.pet=interactPet(JSON.parse(JSON.stringify(d.pet)),'roast',d,now+i)
        const view=companion(d,now+i)
        seen.push(view.text)
        assert.doesNotMatch(view.text,/\{\w+\}/)
        if(i%3!==2) assert.ok(taskLines.includes(view.text),`${scenario}/${mood}: ${view.text}`)
        if(scenario!=='coding') assert.doesNotMatch(view.text,/去写代码|手写代码|commit message|你的代码|你写的 bug/)
      }
      assert.equal(new Set(seen).size,24,`${scenario}/${mood} must not repeat in the first 24 clicks`)
      assert.ok(seen.includes('又来上班？行，今天的 token 我替你烧。'),'original dialogue remains in the mix')
      assert.deepEqual([d.pet.fed,d.pet.patted,d.pet.highest],[3,4,1])
    }
  }
})

test('original inheritance is opt-out and task/persona cursors survive care, mood changes and hot switches', () => {
  const custom={schemaVersion:1,id:'local',extends:'delivery',version:'1',name:'本地'}
  assert.equal(parsePersona(custom,'local').inheritOriginal,true)
  assert.equal(parsePersona({...custom,inheritOriginal:false},'local').inheritOriginal,false)
  const now=Date.parse('2026-11-10T04:00:00Z'), d=demoDashboard(now)
  const select=(scenario:TaskScenario,id='delivery')=>{
    d.task={scenario,signals:[],at:now}
    d.dialogue={personaId:id,revision:'test',pools:personaPools(DELIVERY_PERSONA,d.task),inheritOriginal:true,taskLines:taskLinesFor(DELIVERY_PERSONA,d.task)}
  }
  select('slides')
  d.pet=interactPet(d.pet,'roast',d,now)
  assert.equal(companion(d,now).text,DELIVERY_PERSONA.scenes.slides![0])
  for(const action of ['feed','pat'] as const) d.pet=interactPet(d.pet,action,d,now+1)
  select('commercial')
  d.pet=interactPet(d.pet,'roast',d,now+2)
  assert.equal(companion(d,now+2).text,DELIVERY_PERSONA.scenes.commercial![0])
  select('slides','another')
  d.pet=interactPet(d.pet,'roast',d,now+3)
  assert.equal(companion(d,now+3).text,DELIVERY_PERSONA.scenes.slides![0])
  select('slides')
  d.quota.windows[0].usedPercent=100
  d.pet=interactPet(d.pet,'roast',d,now+4)
  assert.equal(companion(d,now+4).text,DELIVERY_PERSONA.scenes.slides![1])
  assert.equal(companion(d,now+4).action,null)
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
