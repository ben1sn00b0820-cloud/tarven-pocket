import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIncomingIdentities,resolveIdentity,resolveKnownReference} from '../src/identity.js';

const state=()=>({characters:{
  c_yun:{id:'c_yun',name:'雲璃',aliases:['璃兒'],present:false,values:{}},
  c_wang:{id:'c_wang',name:'王子晟',aliases:[],present:true,values:{}}
}});

test('presence names and aliases map to unique existing IDs without creating people',()=>{
  const before=state(),copy=structuredClone(before);
  const result=normalizeIncomingIdentities({version:1,characters:[],present:['雲璃','璃兒','c_wang']},before);
  assert.deepEqual(result.payload.present,['c_yun','c_wang']);
  assert.deepEqual(result.payload.characters,[]);assert.deepEqual(before,copy);
});

test('a misplaced exact known name in id can omit name but invented IDs cannot',()=>{
  assert.equal(resolveIdentity({id:'雲璃',present:true},state()).id,'c_yun');
  assert.equal(resolveIdentity({id:'璃兒',present:false},state()).id,'c_yun');
  assert.throws(()=>resolveIdentity({id:'c_yunli_invented',present:true},state()),/缺少 name/);
  assert.equal(resolveKnownReference('c_yunli_invented',state()),null);
});

test('unknown roster members cannot erase everyone else or discard a known arrival',()=>{
  const result=normalizeIncomingIdentities({version:1,characters:[{id:'bad_without_name',set:{}}],present:['bad_without_name','雲璃']},state());
  assert.equal(result.payload.present,undefined);
  assert.deepEqual(result.payload.characters,[{id:'c_yun',present:true,reason:'本輪在場名單明確列出此角色'}]);
  assert(result.diagnostics.some(d=>d.kind==='error'&&d.message.includes('缺少 name')));
  assert(result.diagnostics.some(d=>d.message.includes('其餘在場狀態保持原值')));
});

test('a rejected incomplete roster does not overwrite an explicit departure',()=>{
  const result=normalizeIncomingIdentities({version:1,characters:[{id:'c_yun',present:false}],present:['c_yun','unknown']},state());
  assert.equal(result.payload.present,undefined);assert.equal(result.payload.characters[0].present,false);
});

test('ambiguous aliases are never arbitrarily assigned or used as a complete roster',()=>{
  const s=state();s.characters.c_wang.aliases=['璃兒'];
  assert.throws(()=>resolveKnownReference('璃兒',s),/多位/);
  const result=normalizeIncomingIdentities({version:1,characters:[],present:['璃兒']},s);
  assert.equal(result.payload.present,undefined);assert.deepEqual(result.payload.characters,[]);
});

test('an explicit empty complete roster remains distinct from an omitted roster',()=>{
  assert.deepEqual(normalizeIncomingIdentities({version:1,characters:[],present:[]},state()).payload.present,[]);
  assert.equal(normalizeIncomingIdentities({version:1,characters:[]},state()).payload.present,undefined);
});
