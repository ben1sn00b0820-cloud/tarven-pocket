import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationGuard} from '../src/generation.js';

function harness({live=null,document}={}){
  const ctx={};let time=1000,current=live;
  const guard=createGenerationGuard({context:()=>ctx,document,readHostState:()=>current,now:()=>time});
  return {ctx,guard,setLive(value){current=value;},advance(ms){time+=ms;}};
}

test('dry runs never create a narrative lock or release an existing one',()=>{
  const h=harness();h.guard.start('normal',{},true);assert.equal(h.guard.isBusy(),false);
  h.guard.start('normal');h.guard.start('quiet',{},true);h.advance(3600000);assert.equal(h.guard.isBusy(),true);
});

test('quiet and impersonate do not block scanning even when the broad host flag is true',()=>{
  for(const type of ['quiet','impersonate']){
    const h=harness({live:true});h.guard.start(type);assert.equal(h.guard.isBusy(),false);
    h.guard.finish();assert.equal(h.guard.isBusy(),false);
    h.setLive(false);assert.equal(h.guard.isBusy(),false);
  }
});

test('quiet ownership survives a scheduler probe before the host lock is raised',()=>{
  const h=harness({live:false});h.guard.start('quiet');assert.equal(h.guard.isBusy(),false);
  h.advance(100);h.setLive(true);assert.equal(h.guard.isBusy(),false);
  h.guard.finish();assert.equal(h.guard.isBusy(),false);
  h.setLive(false);assert.equal(h.guard.isBusy(),false);
  h.setLive(true);assert.equal(h.guard.isBusy(),true,'finished background ownership is cleared after idle');
});

test('a real start or unobserved active narrative stream overrides pending quiet ownership',()=>{
  for(const kind of ['event','stream']){
    const h=harness({live:false});h.guard.start('quiet');assert.equal(h.guard.isBusy(),false);
    if(kind==='event')h.guard.start('normal');
    else h.ctx.streamingProcessor={type:'normal',isFinished:false,isStopped:false};
    assert.equal(h.guard.isBusy(),true);
  }
});

test('real non-streaming start gets grace until the host sets its lock',()=>{
  const h=harness({live:false});h.guard.start(undefined);assert.equal(h.guard.isBusy(),true);
  h.advance(200);h.setLive(true);assert.equal(h.guard.isBusy(),true);
  h.setLive(false);assert.equal(h.guard.isBusy(),false);
});

test('idle host reconciles a stale STARTED event after startup grace without an end event',()=>{
  const h=harness({live:false});h.guard.start('normal');h.advance(1499);assert.equal(h.guard.isBusy(),true);
  h.advance(1);assert.equal(h.guard.isBusy(),false);
});

test('a new real start receives grace even if the previous end event was missed',()=>{
  const h=harness({live:true});h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
  h.setLive(false);h.advance(10000);h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
  h.advance(1500);assert.equal(h.guard.isBusy(),false);
});

test('elapsed time cannot unlock a genuine long response',()=>{
  const h=harness({live:true});h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
  h.advance(7200000);assert.equal(h.guard.isBusy(),true);
  h.guard.finish();assert.equal(h.guard.isBusy(),true);
  h.setLive(false);assert.equal(h.guard.isBusy(),false);
});

test('without live signals events remain authoritative, regardless of duration',()=>{
  const h=harness();h.guard.start('normal');h.advance(7200000);assert.equal(h.guard.isBusy(),true);
  h.guard.finish();assert.equal(h.guard.isBusy(),false);
});

test('active narrative streaming wins over idle host and background starts',()=>{
  const h=harness({live:false});h.guard.start('quiet');
  h.ctx.streamingProcessor={type:'normal',isFinished:false,isStopped:false};
  assert.equal(h.guard.isBusy(),true);h.guard.finish();assert.equal(h.guard.isBusy(),true);
  h.ctx.streamingProcessor.isFinished=true;assert.equal(h.guard.isBusy(),false);
});

test('stopped and completed streams reconcile when no broad host signal exists',()=>{
  for(const key of ['isFinished','isStopped']){
    const h=harness();h.ctx.streamingProcessor={type:'normal',isFinished:false,isStopped:false};
    assert.equal(h.guard.isBusy(),true);h.ctx.streamingProcessor[key]=true;assert.equal(h.guard.isBusy(),false);
  }
});

test('a completed old processor cannot hide a new non-streaming generation',()=>{
  const h=harness({live:true});h.ctx.streamingProcessor={type:'normal',isFinished:true};
  h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
});

test('quiet streaming alone is ignored even without receiving its start event',()=>{
  const h=harness({live:true});h.ctx.streamingProcessor={type:'quiet',isFinished:false};
  assert.equal(h.guard.isBusy(),false);h.guard.finish();assert.equal(h.guard.isBusy(),false);
});

test('quiet start and end cannot unlock concurrent real non-streaming generation',()=>{
  const h=harness({live:true});h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
  h.guard.start('quiet');h.guard.finish();assert.equal(h.guard.isBusy(),true);
  h.setLive(false);assert.equal(h.guard.isBusy(),false);
});

test('real start wins over a preceding background-only request',()=>{
  const h=harness({live:true});h.guard.start('quiet');assert.equal(h.guard.isBusy(),false);
  h.guard.start('normal');assert.equal(h.guard.isBusy(),true);
});

test('body marker is fallback only; explicit host idle has priority',()=>{
  const document={body:{dataset:{generating:'true'}}},h=harness({document});
  assert.equal(h.guard.isBusy(),true);h.setLive(false);assert.equal(h.guard.isBusy(),false);
});

test('stop-button computed visibility supplies fallback host state',()=>{
  const stop={hidden:false},style={display:'none',visibility:'visible'};
  const document={getElementById:()=>stop,defaultView:{getComputedStyle:()=>style}};
  const h=harness({document});assert.equal(h.guard.isBusy(),false);
  style.display='block';assert.equal(h.guard.isBusy(),true);
  stop.hidden=true;assert.equal(h.guard.isBusy(),false);
});

test('unavailable and throwing probes fall back to events',()=>{
  const guard=createGenerationGuard({context:()=>{throw Error('unavailable');},document:null,readHostState:()=>{throw Error('unavailable');}});
  guard.start('normal');assert.equal(guard.isBusy(),true);guard.finish();assert.equal(guard.isBusy(),false);
});

test('reset clears event ownership while retaining genuinely active host protection',()=>{
  const h=harness();h.guard.start('normal');h.guard.reset();assert.equal(h.guard.isBusy(),false);
  h.setLive(true);h.guard.reset();assert.equal(h.guard.isBusy(),true);
});
