import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SproutService, type Options} from '../src/server/service'
import {scanUsage} from '../src/server/usage'
import {getQuota} from '../src/server/codex'
import {readGithub} from '../src/server/github'
import {loadPrices} from '../src/server/pricing'
const deferred = () => { let resolve!:()=>void; const promise = new Promise<void>(r=>resolve=r); return {promise,resolve} }
async function promptly<T>(work:Promise<T>) {
  let timer:ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{ timer=setTimeout(()=>reject(new Error('panel waited for background work')),1000) })]) }
  finally { clearTimeout(timer) }
}
test('cached local usage and interactions return while all remote dependencies are unresolved',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sprout-latency-')), gate=deferred(), started=new Set<string>()
 const opts:Options={codexHome:root,dataDir:join(root,'state'),timezone:'UTC',binary:'unused',live:true,github:true,prices:{},refreshPrices:true}
 let service:SproutService|undefined
 try {
  await mkdir(join(root,'sessions'))
  await writeFile(join(root,'sessions/a.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,output_tokens:0}}}})+'\n')
  await scanUsage(root,opts.dataDir,'UTC')
  service=new SproutService(opts,{
   scanUsage,
   loadPrices:async(dir,online,prices)=>{if(online){started.add('prices');await gate.promise}return loadPrices(dir,false,prices)},
   getQuota:async()=>{started.add('quota');await gate.promise;return {source:'live',message:null,windows:[{id:'live',label:'live',usedPercent:25,windowMinutes:300,observedAt:Date.now(),resetsAt:Date.now()+3600000,projected:null}]}},
   readGithub:async()=>{started.add('github');await gate.promise;return {fetchedAt:Date.now(),total:3,days:[],merges:[],mergesComplete:true}},
  })
  const first=await promptly(service.get())
  assert.equal(first.usage.totals.total,100)
  assert.deepEqual([...started].sort(),['github','prices','quota'])
  assert.equal((await promptly(service.interact('feed'))).fed,1)
  assert.equal((await promptly(service.refresh())).usage.totals.total,100)
  gate.resolve();await service.settled()
  const updated=await service.refresh()
  assert.equal(updated.quota.windows[0].usedPercent,25)
  assert.equal(updated.github?.total,3)
 }finally{gate.resolve();await service?.settled();await rm(root,{recursive:true,force:true})}
})
test('a cold history import exposes loading immediately and does not advance growth from incomplete data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sprout-cold-')),gate=deferred()
 const opts:Options={codexHome:root,dataDir:join(root,'state'),timezone:'UTC',binary:'unused',live:false,github:false,prices:{}}
 const service=new SproutService(opts,{getQuota,readGithub,loadPrices,scanUsage:async(...args)=>{await gate.promise;return scanUsage(...args)}})
 try {
  const cold=await promptly(service.get())
  assert.equal(cold.usage.loading,true);assert.equal(cold.pet.initialized,undefined)
  assert.equal((await promptly(service.get(true))).usage.loading,true)
  gate.resolve();await service.settled()
  const warm=await service.get()
  assert.equal(warm.usage.loading,false);assert.equal(warm.pet.initialized,true)
 }finally{gate.resolve();await service.settled();await rm(root,{recursive:true,force:true})}
})
