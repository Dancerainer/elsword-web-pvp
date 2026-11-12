import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile} from '../fixtures/is-native-simulation.mjs';
import {bmFixture} from '../helpers/bm-fixture.mjs';
import {createAfterimageClock,AFTERIMAGE_REFERENCE,PHOENIX_AFTERIMAGE_INTERVAL_SECONDS} from '../../packages/presentation/buff-afterimage.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const advance=(sim,n,dt=1/120)=>{const events=[];for(let i=0;i<n;i++){sim.step(dt,{}, {snapshot:false});events.push(...sim.drainEvents());}return events;};
for(const facing of [-1,1])test(`Sword Fall enhanced +2 is six independent live releases, normal remains four: ${facing}`,()=>{
 assert.equal(profile.skillCatalog.find(s=>s.skillId===21033).replacesSkillId,21019);
 for(const [skillId,count]of [[21019,4],[21033,6]]){
 const sim=make({skillId,facing,target:false,unenhancedSwordFall:skillId===21019});sim.step(1/120,{is:{pressed:['A']}});
 const events=advance(sim,300),releases=events.filter(e=>e.type==='effectStarted'&&/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name));
 assert.equal(releases.length,count);assert.equal(new Set(releases.map(e=>e.effectId)).size,count);assert.equal(new Set(releases.map(e=>e.time)).size,count);
 }
});
test('Enhanced preparation interruption and wire continuation retain independent extra sword handles',()=>{
 const sim=make({skillId:21033,target:false}),receiver=make({skillId:21033,target:false});sim.step(1/120,{is:{pressed:['A']}});advance(sim,65);
 const owned=encodeOwnedState(sim,'is',{epoch:1,frameSeq:65});validateOwnedState(owned);applyOwnedState(receiver,'is',owned);
 assert.equal(sim.actor('is').sourceInfinitySword.swordFallEffectIds.length,6);
 const ids=receiver.actor('is').sourceInfinitySword.swordFallEffectIds;
 assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);
 assert.ok(ids.every(id=>receiver.state.effects.some(e=>e.id===id&&/^elsword_A_swordFall_M0[2-5]$/.test(e.name))));
 sim.enter(sim.actor('is'),'RSI_WAIT','interrupt-fixture');
 assert.equal(advance(sim,240).filter(e=>e.type==='effectStarted'&&/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name)).length,0);
});
test('Phoenix v26 user display budget is .1 second while original .02 source evidence remains separate',()=>{
 assert.equal(AFTERIMAGE_REFERENCE.intervalSeconds,.02);assert.equal(PHOENIX_AFTERIMAGE_INTERVAL_SECONDS,.1);
 for(const dt of [1/60,1/120]){const c=createAfterimageClock(10),captures=[];
  for(let i=0;i<Math.round(10/dt);i++)if(c.step(dt,true).capture!==null)captures.push(i*dt);
  assert.equal(captures[0],0);
  // A discrete display step may cross the requested deadline by one frame.
  // Keep both the minimum interval and that bounded sampling error checked.
  for(let i=1;i<captures.length;i++){const gap=captures[i]-captures[i-1];assert.ok(gap>=.1-1e-9&&gap<=.1+dt+1e-9);}
  assert.ok(captures.length>=Math.ceil(10/(.1+dt))&&captures.length<=101);
  for(let i=0;i<Math.round(1/dt);i++)c.step(dt,false);assert.ok(c.step(dt,false).alpha.every(n=>n===0));}
});
test('BM second airborne Z cannot emit dive cue; final Z cue waits for authored .3 boundary',()=>{
 for(const state of ['RSI_DASH_JUMP_COMBO_ZZ','RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ']){
 const {sim,a}=bmFixture({gap:4000,position:[0,3580,0],passives:[]});a.grounded=false;sim.enter(a,state,'probe');sim.drainEvents();
 const events=advance(sim,100),cues=events.filter(e=>e.type==='effectStarted'&&e.actorId==='bm'&&e.name==='RST_ReadyPM');
 assert.equal(cues.length,state==='RSI_DASH_JUMP_COMBO_ZZ'?0:1);
 if(cues.length)assert.ok(cues[0].time>=.3/1.25);
 }
});
test('BM late display creation uses the authored dive timer after the owner leaves the attack state',()=>{
 const {sim,a,profile}=bmFixture({gap:4000,passives:[]});sim.enter(a,'RSI_WAIT','finished-fixture');
 const definition=profile.effectSets.EFFECTSET_Dash_Jump_ZZZ.raw.EFFECT1;
 const cue=sim.createEffect(a,definition,{setName:'EFFECTSET_Dash_Jump_ZZZ',start:.01});
 assert.equal(cue.start,.3);assert.equal(a.state,'RSI_WAIT');
});
