import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityOf, consumeActivity, freshActivity } from '../src/server/activity'
import { observePet } from '../src/core/pet-events'
import { companion, interactPet } from '../src/core/companion'
import { sceneSvg } from '../src/core/scene'
import { demoDashboard } from '../src/server/demo'
import { LINES, LINES_EN, linesFor } from '../src/core/lines'
import { setLang } from '../src/core/i18n'
import { wrapText } from '../src/core/logic'
import { growthCards } from '../src/core/growth'
import { panelContext, folderName } from '../src/server/context'
import { CLASSIC_PERSONA, DELIVERY_PERSONA, personaPools } from '../src/core/personality'

const now = Date.parse('2026-11-10T04:00:00Z')
const record = (payload: object, at = now, type = 'event_msg') => ({ type, timestamp: new Date(at).toISOString(), payload })
const command = (id: string, exit: number, cmd = 'npm test') => ({ type: 'item_completed', item: { type: 'CommandExecution', id, command: ['/bin/zsh', '-lc', cmd], exit_code: exit, aggregated_output: 'PRIVATE OUTPUT' } })

test('real lifecycle metadata drives escalation, recovery and compaction without retaining content', () => {
  const state = freshActivity()
  consumeActivity(state, record({ id: 'session', source: 'cli', base_instructions: 'PRIVATE PROMPT' }, now-1000, 'session_meta'))
  consumeActivity(state, record({ type: 'task_started', turn_id: 'turn', collaboration_mode_kind: 'default' }, now-500))
  for (let i=1;i<=3;i++) consumeActivity(state, record(command(String(i), 1), now+i))
  assert.equal(state.event?.failures, 3)
  consumeActivity(state, record(command('3', 1), now+4))
  assert.equal(state.failures, 3, 'duplicate completion does not inflate failure count')
  consumeActivity(state, record(command('grep', 1, 'rg absent README.md'), now+5))
  assert.equal(state.failures, 3, 'a no-match search is not a failed test')
  consumeActivity(state, record(command('script', 0, "python3 - <<'PY'\nprint('npm test')\nPY"), now+6))
  consumeActivity(state, record(command('masked', 0, 'npm test; true'), now+6))
  consumeActivity(state, record(command('not-run', 1, 'false && npm test'), now+6))
  assert.equal(state.event?.kind, 'test_failed')
  assert.equal(state.failures, 3)
  consumeActivity(state, record(command('pass', 0), now+7))
  assert.equal(state.event?.kind, 'test_passed'); assert.equal(state.failures, 0)
  consumeActivity(state, record({ message: 'PRIVATE SUMMARY' }, now+8, 'compacted'))
  assert.equal(state.event?.kind, 'compact')
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE|npm test|aggregated_output|base_instructions/)
  consumeActivity(state, record({ type: 'task_complete', turn_id: 'turn' }, now+9))
  assert.equal(state.active, false)
  assert.equal(activityOf([state], now+10).event?.kind, 'compact')
  assert.equal(activityOf([state], now+100_000).event, null)
})

test('activity ignores archived/stale runs and copied forks; agents require live child sessions', () => {
  const parent = freshActivity(), child = freshActivity()
  consumeActivity(parent, record({ type: 'task_started', turn_id: 'parent' }, now-130_000))
  consumeActivity(child, record({ id: 'child', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }, now-140_000, 'session_meta'))
  consumeActivity(child, record({ type: 'task_started', turn_id: 'child-turn' }, now-120_000))
  assert.equal(activityOf([parent, { ...parent }, child], now).active, 2)
  assert.equal(activityOf([parent, child], now).agents, 1)
  assert.equal(activityOf([parent, child], now+400_000).active, 0)
})

test('reset rain needs a fresh real quota drop, survives restarts and never repeats on refresh', () => {
  const d = demoDashboard(now), window = { ...d.quota.windows[0], usedPercent: 98 }
  const first = observePet(d.pet, [window], d.timezone, now)
  assert.equal(first.rainUntil, undefined)
  const stale = observePet(first, [{ ...window, usedPercent: 0 }], d.timezone, now+1000)
  assert.equal(stale.rainUntil, undefined, 'same observation cannot create a reset')
  const lower = { ...window, usedPercent: 3, observedAt: now+10_000 }
  const recovered = observePet(first, [lower], d.timezone, now+10_000)
  assert.equal(recovered.rainUntil, now+70_000)
  const restored = JSON.parse(JSON.stringify(recovered))
  assert.equal(observePet(restored, [lower], d.timezone, now+20_000).rainUntil, now+70_000)
  assert.equal(observePet(first, [], d.timezone, now+20_000).rainUntil, undefined)
  assert.equal(observePet(first, [{ ...lower, observedAt: now-600_000 }], d.timezone, now).rainUntil, undefined)
})

test('praying is cosmetic; repeated care escalates without changing growth, quota or other counters', () => {
  const d = demoDashboard(now), before = structuredClone(d)
  let pet = interactPet(d.pet, 'pray', d, now)
  assert.equal(pet.prayed, 1); assert.equal(pet.highest, before.pet.highest)
  assert.deepEqual(d.quota, before.quota); assert.deepEqual(d.usage, before.usage)
  assert.equal(companion({ ...d, pet }, now).effect, 'pray')
  for (let i=0;i<3;i++) pet = interactPet(pet, 'feed', d, now+5000+i*100)
  assert.equal(pet.fed, before.pet.fed+3); assert.equal(pet.patted, before.pet.patted)
  assert.equal(companion({ ...d, pet }, now+5200).effect, 'umbrella')
  assert.equal(pet.line?.bucket, 'overwater')
  for (let i=0;i<3;i++) pet = interactPet(pet, 'pat', d, now+6000+i*100)
  assert.equal(companion({ ...d, pet }, now+6200).effect, 'hide')
  assert.equal(companion({ ...d, pet }, now+10_000).effect, null)
  pet = interactPet(pet, 'pat', d, now+30_000)
  assert.equal(pet.burst?.count, 1, 'a pause resets the burst')
})

test('cat visits at most once per day automatically; clicking cat chooses its own lines', () => {
  const d = demoDashboard(now)
  const first = observePet(d.pet, [], d.timezone, now)
  const visit = observePet(first, [], d.timezone, now+61_000)
  assert.equal(visit.cat?.until, now+151_000)
  const after = observePet(visit, [], d.timezone, now+200_000)
  assert.equal(after.cat?.until, visit.cat?.until)
  const clicked = interactPet(after, 'cat', d, now+201_000)
  assert.equal(clicked.line?.bucket, 'cat')
  assert.equal(companion({ ...d, pet: clicked }, now+201_000).showCat, true)
  assert.equal(clicked.fed, d.pet.fed)
})

test('roast leaves every care/easter-egg pool immediately, including rapid pat animation', () => {
  for (const kind of ['feed', 'pat', 'pray', 'cat'] as const) {
    for (const count of [1, 3]) {
      const d = demoDashboard(now)
      d.quota.windows = []
      d.activity = { active: 1, agents: 0, startedAt: now-180_000, planning: false, event: null }
      let pet = d.pet
      for (let i=0; i<count; i++) pet = interactPet(pet, kind, d, now+i)
      const counters = [pet.fed, pet.patted, pet.highest]
      pet = interactPet(pet, 'roast', d, now+10)
      assert.equal(pet.line?.bucket, 'busy', `${kind} × ${count} must not hijack roast`)
      const view = companion({ ...d, pet }, now+10)
      assert.equal(view.key, 'busy')
      assert.equal(view.action, null)
      assert.deepEqual([pet.fed, pet.patted, pet.highest], counters)
      assert.equal(pet.burst, undefined)
    }
  }
})

test('three buttons have independent rotations through alternating actions and restored saves', () => {
  const d = demoDashboard(now)
  d.quota.windows = []
  const seen = { feed: new Set<string>(), pat: new Set<string>(), roast: new Set<string>() }
  let pet = d.pet
  for (let i=0; i<8; i++) {
    for (const action of ['feed', 'pat', 'roast'] as const) {
      pet = interactPet(JSON.parse(JSON.stringify(pet)), action, d, now+i*100)
      const text = companion({ ...d, pet }, now+i*100).text
      assert.equal(seen[action].has(text), false, `${action} repeated before its pool was exhausted`)
      seen[action].add(text)
    }
  }
})

test('rapid care retains escalation with twelve lines; contextual roasting does not loop on four lines', () => {
  for (const pack of [CLASSIC_PERSONA, DELIVERY_PERSONA]) {
    const d = demoDashboard(now)
    d.quota.windows = []
    d.dialogue = { personaId: pack.id, revision: 'test', pools: personaPools(pack, { scenario:'slides', signals:['layout','review'], at:now }) }
    for (const action of ['feed', 'pat', 'roast'] as const) {
      let pet = d.pet
      const lines = new Set<string>()
      d.activity = { active:1,agents:0,startedAt:now-180_000,planning:false,event:{kind:'compact',at:now,failures:0} }
      for (let i=0; i<14; i++) {
        pet = interactPet(pet, action, d, now+i*100)
        if (i>=2) lines.add(companion({ ...d, pet }, now+i*100).text)
      }
      assert.equal(lines.size, 12, `${pack.id}/${action} should offer twelve distinct successive lines`)
      if (action !== 'roast') assert.equal(pet.line?.bucket, action === 'feed' ? 'overwater' : 'overpat')
    }
  }
})

test('new scenes use event state and expiry; failure lines escalate deterministically', () => {
  const d = demoDashboard(now)
  for (let failures=1;failures<=3;failures++) {
    d.activity = { active: 1, agents: 0, startedAt: now-180_000, planning: false, event: { kind: 'test_failed', at: now, failures } }
    assert.equal(companion(d,now).text, LINES.test_failed[failures-1])
  }
  d.activity!.event = { kind:'test_passed', at:now, failures:3 }
  assert.equal(companion(d,now).effect, 'flower')
  d.activity!.event = { kind:'compact', at:now, failures:0 }
  assert.equal(companion(d,now).effect, 'compact')
  d.pet.line = { bucket:'feed', index:0, at:now-10_000 }
  assert.equal(companion(d,now).key, 'compact', 'a new work event supersedes an older manual line')
  d.pet.line = undefined
  d.activity!.event = null
  assert.equal(companion(d,now).effect, 'cup')
  d.activity!.planning = true
  assert.equal(companion(d,now).key, 'planning')
  d.activity!.active = 3; d.activity!.agents = 2
  assert.equal(companion(d,now).effect, 'agents')
  assert.notEqual(companion(d,now+100_000).key, 'agents', 'stale snapshots do not invent ongoing work')
  d.pet = observePet({ ...d.pet, lastSeenAt:now-3*86_400_000 }, [], d.timezone, now)
  d.activity = undefined
  assert.equal(companion(d,now).effect, 'return')
})

test('scene retains its original dimensions and exposes keyboard-accessible cloud and cat', () => {
  const svg = sceneSvg({ width:312, mood:'worry', action:null, level:1, pips:0, isConfetti:false, isDay:true, rows:['测试'], isPop:false, cat:true, canPray:true, effect:'rain' })
  assert.match(svg, /viewBox="0 0 312 150"/)
  assert.match(svg, /data-action="cat" role="button" tabindex="0"/)
  assert.match(svg, /data-action="pray" role="button" tabindex="0"/)
  assert.match(svg, /rain-drop-/)
})

test('all new pools have translations, resolve variables and fit the existing bubble', () => {
  setLang('zh')
  for (const key of ['pray','reset','cat','overwater','overpat','return','busy','planning','compact','agents','test_failed','test_passed','done','interrupted','approval'] as const) {
    assert.equal(LINES[key].length, LINES_EN[key].length)
    const lines = linesFor([key], { streak:7, lost:7, level:'Lv2 幼苗', total:'$10', today:'$1', hit:'90%', tokens:'1B', five:'90%', week:'90%', fullAt:'12:00', reset:'14:00', pr:'#1', fed:3, patted:3, time:'02:00', agents:3 })
    assert.equal(lines.length, LINES[key].length)
    for (const line of lines) {
      assert.doesNotMatch(line.text, /\{\w+\}/)
      assert.equal(wrapText(line.text, 11, 3).isCut, false, line.text)
    }
  }
})

test('atlas uses real level thresholds and a seven-calendar-day rate without changing the pet', () => {
  const d=demoDashboard(now), before=structuredClone(d.pet)
  d.pet.highest=2;d.usage.totals.total=25e9
  d.usage.days=[{...d.usage.days.at(-1)!,total:7e9}]
  const cards=growthCards(d)
  assert.equal(cards.length,9)
  assert.equal(cards[0].status,'unlocked')
  assert.equal(cards[1].status,'current')
  assert.equal(cards[1].target,35e9)
  assert.equal(cards[1].etaDays,10)
  assert.equal(cards[1].progress,1/3)
  assert.equal(cards[2].etaDays,10)
  d.usage.days=[]
  assert.equal(growthCards(d)[2].etaDays,null)
  d.pet.highest=before.highest
  assert.deepEqual(d.pet,before)
})

test('project context prefers the host chat and extracts folder names without guessing another chat', () => {
  assert.deepEqual(panelContext({threadId:'wrong',cwd:'/work/Project'}, {'x-codex-turn-metadata':'{"thread_id":"right"}'}),{threadId:'right'})
  assert.deepEqual(panelContext({cwd:'/work/Project'}, {'x-codex-turn-metadata':'{"thread_id":"right"}'}),{threadId:'right',cwd:'/work/Project'})
  assert.deepEqual(panelContext({}, {'x-codex-turn-metadata':'broken'}),{})
  assert.equal(folderName('/work/Audi BI PoC/'),'Audi BI PoC')
  assert.equal(folderName('C:\\work\\项目\\'),'项目')
  assert.equal(folderName(),null)
})
