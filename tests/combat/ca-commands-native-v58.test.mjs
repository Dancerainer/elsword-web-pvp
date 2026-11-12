/** New independent 2016 static predicates plus current Web actual sampled
 * device input, original Garpai collision and original character/helper pose.
 * This is not an original-client dynamic recording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),source=read('contracts/ca-commands-native-v58.json'),dt=1/60;
const wave='DamageEffect_SCA_Combo_ZZZ_Projectile01',finish=wave+'_Finish';
function device(sim,a){
 const input=createInputBuffer({sampledLevels:true}),events=[],rows=[];
 const sourceState=()=>sim.profileFor(a).states[a.state].sourceState??a.state;
 function step(){const keys=input.consume(sim.state.time+dt);sim.step(dt,{[a.id]:keys},{snapshot:false});events.push(...sim.drainEvents());
  rows.push({state:sourceState(),clock:a.animationTime,stopped:a.animationStopped,y:a.y,grounded:a.grounded,serial:a.stateSerial,keys});}
 const edge=(key,on)=>{input[on?'down':'up'](key,sim.state.time+.001);step();};
 const tap=key=>{edge(key,true);edge(key,false);};
 const until=(p,label,max=240)=>{for(let n=0;n<max&&!p();n++)step();assert.ok(p(),`${label}: ${sourceState()}@${a.animationTime}`);};
 const state=n=>until(()=>sourceState()===n,n);
 const clock=t=>{const s=a.stateSerial;until(()=>a.animationTime>=t||a.stateSerial!==s,'clock '+t);assert.equal(a.stateSerial,s);};
 const dash=()=>{step();const forward=a.facing>0?'RIGHT':'LEFT';tap(forward);edge(forward,true);for(let n=0;n<3;n++)step();};
 const dashJump=()=>{dash();tap('UP');for(let n=0;n<4;n++)step();};
 function dashZStart(){dash();tap('Z');tap('Z');state('ESI_DASH_COMBO_SCA_ZZ');tap('Z');state('ESI_DASH_COMBO_SCA_ZZZ_START');}
 return {input,events,rows,step,edge,tap,until,state,clock,dash,dashJump,dashZStart,sourceState};
}
const waves=i=>i.events.filter(e=>e.type==='effectStarted'&&e.name?.startsWith(wave));
test('CA source seal is independently hashed and Finish retains its own DD, helper and raw queues',()=>{
 assert.equal(source.originalClientExecuted,false);assert.equal(source.rawConfigurationChanged,false);
 for(const b of source.blocks)assert.equal(createHash('sha256').update(Buffer.from(b.hex,'hex')).digest('hex'),b.sha256);
 const p=read('packages/combat-core/ca-profile.json');
 for(const[n,row]of Object.entries(source.states))assert.deepEqual(p.states[n].raw,row.raw,n);
 assert.deepEqual(source.producerRows.ESI_DASH_COMBO_SCA_ZZZ_LOOP_1,[[.01,'EffectSet_C_SCA_Dash_ZZZ_Uppercut'],[.25,'EffectSet_C_SCA_Dash_ZZZ']]);
 assert.deepEqual(source.producerRows.ESI_DASH_COMBO_SCA_ZZZ_LOOP_2,[[.08,'EffectSet_C_SCA_Dash_ZZZ'],[.31,'EffectSet_C_SCA_Dash_ZZZ_Uppercut']]);
 assert.deepEqual(source.producerRows.ESI_DASH_COMBO_SCA_ZZZ_END,[[.37,'EffectSet_C_SCA_Dash_ZZZ_Finish']]);
 const dd=source.damageEffects[finish].raw.DAMAGE_DATA;
 assert.equal(dd.REACT_TYPE,5);assert.equal(dd.BACK_SPEED_X,1500);assert.equal(dd.BACK_SPEED_Y,700);
 assert.equal(dd.DAMAGE.PHYSIC,.87);assert.equal(dd.RE_ATTACK,1);assert.equal(dd.HIT_GAP,.1);
 const t=source.effectTemplates.SCA_Combo_ZZZ_Projectile_Finish_AttackBoX;
 assert.equal(t.fields.LifeTime,.33);assert.deepEqual(t.initialVelocity,[2250,0,0]);
 assert.deepEqual(source.effectSets.EffectSet_C_SCA_Dash_ZZZ_Finish.raw.EFFECT0,
  {NAME:finish,SCALE_X:1.33,SCALE_Z:1.33,SCALE_Y:1.33,EFFECT_TYPE:1});
});

for(const facing of [-1,1]){
 test(`CA ${facing}: full real66Z sampled chain produces original raw plus frame waves and independent final launch`,()=>{
  const {sim,a,profile}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.dashZStart();
  i.tap('Z');i.state('ESI_DASH_COMBO_SCA_ZZZ_LOOP_1');
  for(let n=1;n<4;n++){i.clock(.1);i.tap('Z');i.state(n%2?'ESI_DASH_COMBO_SCA_ZZZ_LOOP_2':'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1');}
  assert.equal(a.sourceElesisCommand.loops,4);i.state('ESI_DASH_COMBO_SCA_ZZZ_END');i.clock(.5);
  const names=waves(i).map(e=>e.name);
  assert.equal(names.filter(n=>n===wave).length,8,'three raw normals plus START and one normal callback in each of four loops');
  assert.equal(names.filter(n=>n===wave+'_Uppercut').length,6,'two raw uppercuts plus one Uppercut callback in each of four loops');
  assert.equal(names.filter(n=>n===finish).length,1,'original .37 END creates the separate Finish DD');
  assert.equal(names.length,15);
  for(const n of ['START','LOOP_1','LOOP_2','END'])assert.ok(profile.states['ESI_DASH_COMBO_SCA_ZZZ_'+n].raw.DAMAGE_DATA.DAMAGE.PHYSIC>0);
 });
 test(`CA ${facing}: releasing after first LOOP still enters original END and emits its own Finish`,()=>{
  const {sim,a}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.dashZStart();i.tap('Z');i.state('ESI_DASH_COMBO_SCA_ZZZ_LOOP_1');
  i.state('ESI_DASH_COMBO_SCA_ZZZ_END');assert.equal(a.sourceElesisCommand.loops,1);i.clock(.5);
  assert.deepEqual(waves(i).map(e=>e.name),[wave,wave,wave+'_Uppercut',wave,wave,finish]);
 });
 test(`CA ${facing}: SDKXX third freshX remains queued in air until landing, then exactly one Uppercut`,()=>{
  const {sim,a}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.dashJump();i.tap('X');i.tap('X');i.state('ESI_DASH_JUMP_COMBO_SDK_XX');
  assert.equal(a.grounded,false);i.tap('X');i.until(()=>a.animationStopped,'SDKXX original ONE_WAIT stop');
  assert.equal(i.sourceState(),'ESI_DASH_JUMP_COMBO_SDK_XX');assert.equal(a.grounded,false);assert.equal(waves(i).length,0);
  i.state('ESI_DASH_JUMP_COMBO_SDK_XXX');assert.equal(a.grounded,true);i.until(()=>waves(i).length>0,'thirdX Uppercut');
  for(let n=0;n<90;n++)i.step();assert.deepEqual(waves(i).map(e=>e.name),[wave+'_Uppercut']);
 });
 for(const followup of [null,'Z','XZ'])test(`CA ${facing}: SDKXX landing latch ${followup??'none'} has source Z priority and no second-X projectile`,()=>{
  const {sim,a}=elesisFixture('CA',{gap:5000,facing}),i=device(sim,a);i.dashJump();i.tap('X');i.tap('X');i.state('ESI_DASH_JUMP_COMBO_SDK_XX');
  if(followup==='XZ'){i.tap('X');i.tap('Z');}else if(followup)i.tap(followup);
  i.state(followup?'ESI_COMBO_Z':'ESI_DASH_JUMP_COMBO_XX_LANDING');
  assert.equal(waves(i).length,0);
 });
 test(`CA ${facing}: independent original Finish helper hits target with1500/700 FLY and original scale`,()=>{
  const {sim,a,b}=elesisFixture('CA',{gap:350,facing}),i=device(sim,a),contacts=[],apply=sim.applyHit.bind(sim);
  sim.applyHit=(attacker,target,data,origin)=>{const e=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null;
   const result=apply(attacker,target,data,origin);if(result.accepted&&e?.name===finish)contacts.push({data:{...data},origin:{...origin},state:target.state,vx:target.vx,vy:target.vy});return result;};
  i.step();sim.enter(a,'ESI_DASH_COMBO_SCA_ZZZ_END','v58-original-independent-Finish-contact');
  for(let n=0;n<100;n++)i.step();
  assert.equal(waves(i).filter(e=>e.name===finish).length,1);assert.ok(contacts.length>=1,'actual BREAKING_FIST original posed helper contact');
  assert.ok(contacts.every(c=>c.data.REACT_TYPE===5&&c.data.BACK_SPEED_X===1500&&c.data.BACK_SPEED_Y===700));
  assert.ok(contacts.some(c=>/FLY/.test(c.state)),JSON.stringify(contacts));
 });
}
