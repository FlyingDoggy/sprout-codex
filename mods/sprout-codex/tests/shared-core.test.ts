import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
// The upstream source is CommonJS under tsx on Node 22. Load the helpers
// through that same module graph so the language singleton is shared.
const require = createRequire(import.meta.url)
const {setLang} = require('../../sprout/hooks/i18n.ts')
const {sceneSvg} = require('../../sprout/hooks/scene.ts')
const {tilesSvg,trendSvg,usageHeatmapSvg,githubHeatmapSvg} = require('../../sprout/hooks/panels.ts')
import {test} from 'node:test'
import assert from 'node:assert/strict'
test('shared renderers preserve Claude output in both languages and all nine stages',()=>{
const result:Record<string,string>={}
for(const lang of ['zh','en'] as const){
 setLang(lang)
 const parts=[]
 for(let level=1;level<=9;level++)for(const isDay of [true,false])parts.push(sceneSvg({width:360,level,isDay,mood:'happy',action:null,isConfetti:false,pips:3,rows:['Miao'],isPop:false}))
 parts.push(tilesSvg({width:360,tokensLabel:'tokens',tokens:1234567,costUsd:22,todayUsd:3,streak:4,week:[true,false,true,false,true,true,true],cacheHitRate:.91,bars:[1,2,3,0,4,0,9],previous:null,isIntro:true}))
 const days=[{day:'2026-11-09',tokens:20,costUsd:1},{day:'2026-11-10',tokens:30,costUsd:2}]
 parts.push(trendSvg(360,days,true),usageHeatmapSvg(360,days,'2026-11-09','2026-11-10',true),githubHeatmapSvg(360,'2026-11-01','0123401234','2026-11-10',true))
 result[lang]=createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
assert.deepEqual(result,{"zh":"df4524804f8bc5beb4e3886451e1dbb6c7f82d26159b19bc78c8c7931049c868","en":"a87d9a61463369d9f984d3b3626dc319d19c1361ba77223def970260037f8e60"})
})
