import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestRegistry } from '../src/server/requests.js'

test('explicit cancellation is scoped to both request and session', async () => {
  const registry=new RequestRegistry(10000)
  const pending=registry.run('id','session',new AbortController().signal,async signal=>await new Promise<string>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})))
  assert.equal(registry.cancel('id','other'),false)
  assert.equal(registry.cancel('id','session'),true)
  await assert.rejects(pending,{code:'cancelled'})
})
test('late success after cancellation cannot be accepted', async () => {
  const registry=new RequestRegistry(10000)
  let finish!:(text:string)=>void
  const pending=registry.run('id','session',new AbortController().signal,async()=>await new Promise<string>(resolve=>{finish=resolve}))
  registry.cancel('id','session')
  finish('late result')
  await assert.rejects(pending,{code:'cancelled'})
})
test('an early cancellation prevents a delayed request from starting', async () => {
  const registry=new RequestRegistry(10000)
  registry.cancel('early','session')
  let started=false
  await assert.rejects(registry.run('early','session',new AbortController().signal,async()=>{started=true;return 'result'}),{code:'cancelled'})
  assert.equal(started,false)
  assert.equal(await registry.run('early','other-session',new AbortController().signal,async()=> 'other'), 'other')
})
test('timeout and unload abort backend work and release registry', async () => {
  const registry=new RequestRegistry(10)
  const pending=registry.run('id','session',new AbortController().signal,async signal=>await new Promise<string>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})))
  await assert.rejects(pending,{code:'timeout'})
  assert.equal(registry.cancel('id','session'),false)
  const next=registry.run('next','session',new AbortController().signal,async signal=>await new Promise<string>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})))
  registry.dispose()
  await assert.rejects(next,{code:'cancelled'})
})
