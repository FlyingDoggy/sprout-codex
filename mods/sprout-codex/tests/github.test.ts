import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readGithub } from '../src/server/github'

const initial={viewer:{login:'fixture-user',contributionsCollection:{contributionCalendar:{totalContributions:0,weeks:[]}}}}
test('the search cap is partial even when GitHub says there is no next page; latest merge needs a complete recent query', async()=>{
  const queries:string[]=[];let pages=0
  const d=await readGithub('UTC',Date.parse('2026-11-10T12:00:00Z'),'2026-01-01',async(query,variables)=>{
    if(query.includes('contributionsCollection')) return initial
    queries.push(variables!.q)
    assert.ok(query.includes('issueCount'))
    if(++pages===11) return {search:{issueCount:1,pageInfo:{hasNextPage:false},nodes:[{id:'latest',number:1001,mergedAt:'2026-11-10T11:00:00Z',additions:1,deletions:0}]}}
    return {search:{issueCount:1001,pageInfo:{hasNextPage:pages<10,endCursor:String(pages)},nodes:Array.from({length:100},(_,i)=>({id:`${pages}-${i}`,number:pages*100+i,mergedAt:'2026-11-09T00:00:00Z',additions:1,deletions:0}))}}
  })
  assert.equal(d.merges.reduce((n,x)=>n+x.prs,0),1000)
  assert.equal(d.mergesComplete,false)
  assert.equal(d.latestMerge?.number,1001)
  assert.ok(queries.every(q=>q.includes('sort:updated-desc')))
  assert.match(queries.at(-1)!,/2026-11-10T06:00:00/)
})
test('an incomplete recent search cannot trigger celebrations from an arbitrary subset',async()=>{
  const d=await readGithub('UTC',Date.parse('2026-11-10T12:00:00Z'),'2026-01-01',async query=>query.includes('contributionsCollection')?initial:{search:{issueCount:1001,pageInfo:{hasNextPage:false},nodes:[{id:'old',number:1,mergedAt:'2026-11-10T10:00:00Z',additions:0,deletions:0}]}})
  assert.equal(d.mergesComplete,false);assert.equal(d.latestMerge,null)
})
