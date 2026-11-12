/** Historical v35 declarations/reference receipts stay immutable. Runtime
 * expectations now follow original2016 landing predicates recovered in v58;
 * the2026 .5 interval adapter was never original-client dynamic gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {elesisCommands} from '../../packages/combat-core/elesis-commands.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profile=read('packages/combat-core/ca-profile.json'),contract=read('contracts/ca-cancel-interval-source-v35.json'),audit=read('reports/ca-cancel-audit-v35.json');
const assetRoot=process.env.ELESIS_ASSET_ROOT??resolve(import.meta.dirname,'../../artifacts');
const map=JSON.parse(readFileSync(resolve(assetRoot,'scene/sander-garpai-rock-pvp/collision.json')));
const state='ESI_DASH_JUMP_COMBO_SDK_XX',next='ESI_DASH_JUMP_COMBO_SDK_XXX';
const keys=pressed=>({held:new Set(),pressed:new Set(pressed??[]),pureDoubleLeft:false,pureDoubleRight:false});
const source=s=>profile.states[s]?.sourceState??s;
function actor({before=.4932,now=.55485,flags=1,grounded=false,facing=1,stopped=false}={}){
 return {id:'ca',professionId:'CA',state,animationBeforeTime:before,animationTime:now,animationStopped:stopped,
  grounded,lineId:grounded?0:null,x:0,y:10000,z:0,vx:0,vy:0,facing,passiveSpeed:{x:0,y:0,z:0},sourceCommandFlags:flags,
  stats:{moveSpeedMultiplier:1},awakening:{orbs:0,remaining:0}};
}
test('CA interval historical contract retains original declarations and qualified end primitive separately from the replaced Web adapter',()=>{
 assert.equal(contract.targetClientMeasured,false);assert.equal(contract.webAdapter.evidenceClass,'current-Web-60Hz-interval-adapter');
 assert.equal(contract.original2016.profileSha256,audit.sources.profileSha256);
 const original=audit.inventory.find(row=>row.sourceState===state);assert.ok(original?.originalDeclarationPresent);
 assert.equal(createHash('sha256').update(JSON.stringify(profile.states[state].raw)).digest('hex'),original.rawOriginalSha256);
 assert.equal(profile.states[state].sourceState,state);assert.equal(profile.states[state].animationName,contract.original2016.animationName);
 assert.equal(profile.states[state].clip.decodedKeysSha256,contract.original2016.clipDecodedKeysSha256);
 assert.deepEqual(profile.states[state].raw.EVENT_PROCESS_TIME0,{'1':0,'2':100,'3':.5});
 assert.equal(profile.states[state].raw.ANIM_SPEED,2.7);assert.equal(profile.states[state].clip.durationSeconds,.6);
 assert.equal(contract.endPrimitive.defaultEndThreshold,.54);
 assert.ok(contract.fixedV5.files.every(f=>f.sha256.length===64&&f.fragments.every(s=>s.sha256.length===64)));
 assert.equal(read('contracts/ca-commands-native-v58.json').originalClientExecuted,false);
});
for(const facing of [-1,1])for(const grounded of [false,true])test(`CA interval ${facing}/${grounded}: actual support, not .5/.54 crossing, selects bufferedX`,()=>{
 const a=actor({facing,grounded}),r=elesisCommands.runEvent(a,keys(),profile);
 assert.equal(source(r.state),grounded?next:null);assert.equal(r.flags&1,1);assert.equal(r.y,a.y);
});
for(const fresh of [false,true])test(`CA interval: crossing old end stays in air${fresh?' and accepts freshX':''}`,()=>{
 const a=actor({flags:0}),r=elesisCommands.runEvent(a,keys(fresh?['X']:[]),profile);
 assert.equal(r.state,null);assert.equal(r.flags&1,fresh?1:0);assert.equal(r.y,a.y);
});
for(const before of [undefined,NaN,-Infinity,.4932,.51,.55])test(`CA interval: previous clock ${before} cannot expire original landing latch`,()=>{
 const a=actor({now:.61165});a.animationBeforeTime=before;
 assert.equal(elesisCommands.runEvent(a,keys(),profile,{animationBeforeTime:before}).state,null);
 a.animationStopped=true;assert.equal(elesisCommands.runEvent(a,keys(),profile).state,null);
 a.grounded=true;assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),next);
});
test('CA interval: finer packets keep X until support and the original pose stop has no end-fall offset',()=>{
 const a=actor({before:.4932,now:.5}),equal=elesisCommands.runEvent(a,keys(),profile);
 assert.equal(equal.state,null);assert.equal(equal.flags&1,1);
 a.animationBeforeTime=.5;a.animationTime=.523;const after=elesisCommands.runEvent(a,keys(),profile);
 assert.equal(after.state,null);assert.equal(after.flags&1,1);assert.equal(after.y,a.y);
 a.grounded=true;assert.equal(source(elesisCommands.runEvent(a,keys(),profile).state),next);
});
for(const freezeClock of ['hitStop','worldStop'])test(`CA interval: ${freezeClock} freezes clocks and the original buffered X`,()=>{
 const sim=createSimulation({profile,map,preset:{passives:[],guildPassives:[],loadout:Array(8).fill(null)},
  actors:[{id:'ca',professionId:'CA',team:0,position:[0,10000,0],loadout:Array(8).fill(null)}]}),a=sim.actor('ca');
 sim.enter(a,state,'synthetic-Web-interval-freeze-seed');a.grounded=false;a.lineId=null;
 a.animationBeforeTime=Math.fround(.49);a.animationTime=Math.fround(.4932);a.sourceCommandFlags=1;a[freezeClock]=.1;
 const serial=a.stateSerial,before=a.animationBeforeTime,now=a.animationTime;
 for(let i=0;i<3;i++){
  sim.step(1/60,{ca:{held:[],pressed:[],sampledDevice:true}},{snapshot:false});
  assert.equal(a.stateSerial,serial);assert.equal(a.animationBeforeTime,before);assert.equal(a.animationTime,now);assert.equal(a.sourceCommandFlags&1,1);
 }
});
