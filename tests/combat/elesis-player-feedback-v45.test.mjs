/** Original2016 clocks/constants and user-requested exceptions are assertions;
 * these runs are current simulation evidence, never original-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const sourceRoot=resolve(process.env.ELESIS_V45_BASELINE??resolve(import.meta.dirname,'../..'));
const {elesisFixture}=await import(pathToFileURL(resolve(sourceRoot,'tests/helpers/elesis-fixture.mjs')));
const {elesisCommands}=await import(pathToFileURL(resolve(sourceRoot,'packages/combat-core/elesis-commands.mjs')));
const dt=1/60;
function step(f,held=[],pressed=[]){f.sim.step(dt,{elesis:{held,pressed,sampledDevice:true}},{snapshot:false});}
function until(f,p,max=400){for(let i=0;i<max&&!p();i++)step(f);assert.ok(p(),f.a.state+' '+f.a.animationTime);}
const keys=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed)});
test('12 GM spin exposes requested skill/command cancel after its original first-attack cue',()=>{
 const f=elesisFixture('GM',{skillId:28204,gap:5000});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SGM_XX_ATTACK','independent-spin-entry');
 assert.equal(f.profile.states[f.a.state].raw.SKILL_CANCEL_AFTER,999,'raw declaration stays frozen');
 for(const time of [.3,.300001]){
  f.a.animationTime=time;
  const probe=elesisCommands.runEvent(f.a,{...keys(),elesisExternalSkillProbe:true},f.sim.profileFor(f.a));
  assert.equal(probe.state,time===.3?null:'EXTERNAL_SKILL_REQUEST');
 }
 f.a.animationTime=.300001;
 const attack=elesisCommands.runEvent(f.a,keys([],['Z']),f.sim.profileFor(f.a));
 assert.equal(f.sim.profileFor(f.a).states[attack.state].sourceState,'ESI_COMBO_Z');
});
for(const facing of [-1,1])for(const dash of [false,true])test(`11 GM ${facing} dash=${dash}: original registered launch is low and fast`,()=>{
 const f=elesisFixture('GM',{skillId:28204,gap:5000,facing});
 if(dash)f.sim.enter(f.a,'RSI_DASH','independent-dash-entry');
 step(f,['A'],['A']);until(f,()=>f.a.state==='ESI_SI_A_EL_LEAP_CRASH_JUMP');
 assert.equal(f.a.passiveSpeed.x,-1,'no permanent WALK/RUN override');
 assert.equal(Math.abs(f.a.vx),dash?2700:2200);
 assert.equal(f.a.vy,1000);
 const floor=f.a.y;let apex=floor;
 for(let i=0;i<180&&f.a.state!=='ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING';i++){step(f);apex=Math.max(apex,f.a.y);}
 assert.ok(apex-floor<150,'the original1000 launch cannot inherit ordinary1500 jump height');
 assert.equal(f.a.state,'ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING');
});
for(const facing of [-1,1])test(`11 GM ${facing}: close-range Leap accepts an actual native hit`,()=>{
 const f=elesisFixture('GM',{skillId:28204,gap:100,facing});step(f,['A'],['A']);
 for(let i=0;i<100;i++)step(f);
 assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId===f.a.id&&e.targetId===f.b.id&&e.amount>0));
});
for(const facing of [-1,1])test(`17 CA ${facing}: original FLIP_DIR_END turns after crossing slash`,()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000,facing});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZX_START','independent-direction-entry');
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZX_LOOP','source-followup');
 assert.equal(f.a.facing,-facing);
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZX_ATTACK','source-release');
 assert.equal(f.a.facing,-facing,'turn exactly once');
});
test('16 CA dash-Z fresh requests repeat the two original phases to their four-phase budget',()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_ZZZ_START','independent-original-loop');
 const seen=[];
 for(const state of ['ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']){
  f.a.animationTime=.1;let r=elesisCommands.runEvent(f.a,keys([],['Z']),f.sim.profileFor(f.a));
  f.a.sourceCommandFlags=r.flags;f.a.animationTime=f.a.state.endsWith('START')?.660001:.380001;
  r=elesisCommands.runEvent(f.a,keys(),f.sim.profileFor(f.a));assert.equal(r.state,state);
  f.sim.enter(f.a,r.state,'source-buffered-advance');seen.push(state);
 }
 assert.equal(f.a.sourceElesisCommand.loops,4);
 f.a.animationTime=.1;const r=elesisCommands.runEvent(f.a,keys([],['Z']),f.sim.profileFor(f.a));
 assert.equal(r.flags&1,0,'fifth phase cannot buffer');assert.equal(seen.length,4);
});
for(const facing of [-1,1])test(`15 CA ${facing}: 668XXX emits its original .01 uppercut wave and pays3MP`,()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000,facing});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SDK_XXX','independent-wave-callback');
 const mp=f.a.mp;step(f);
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_SCA_Combo_ZZZ_Projectile01_Uppercut');
 assert.ok(e);assert.ok(Math.abs(mp-f.a.mp-3)<.1);
 until(f,()=>e.active);assert.ok(e.sourceLiteralMotion);const x=e.x;
 for(let i=0;i<5;i++)step(f);
 assert.ok((e.x-x)*facing>100,'2250 source projectile moves away from owner');
});
test('15 CA 66XZ creates the separately registered original damage projectile',()=>{
 const f=elesisFixture('CA',{skillId:28221,gap:5000});f.a.skillId=null;
 f.sim.enter(f.a,'ESI_DASH_COMBO_SCA_XZ_FIRE','independent-wave-callback');step(f);
 const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_SCA_Dash_Combo_XZ');assert.ok(e);
 assert.equal(e.damage.DAMAGE_DATA.DAMAGE.PHYSIC,1.675);assert.ok(e.sourceLiteralMotion);
});
test('19 CA Burning Phantom queues original1000/810 pull outside hit range',()=>{
 const f=elesisFixture('CA',{skillId:28021,gap:700});step(f,['A'],['A']);
 until(f,()=>f.a.state==='SI_SA_SDK_BURNING_PHANTOM_LOOP');
 until(f,()=>f.b.effectiveBlackHoleIds?.length>0,120);
 assert.ok(f.b.blackHoleDisplacement.some(n=>n!==0));
 const before=f.b.x-f.a.x;for(let i=0;i<8;i++)step(f);
 assert.ok(f.b.x-f.a.x<before,'original displacement enters real actor physics');
});
test('13 CA Blood Cutter keeps its collision anchor after first accepted hit until source NPC expiry',()=>{
 const f=elesisFixture('CA',{skillId:28023,gap:500});step(f,['A'],['A']);
 until(f,()=>f.sim.state.effects.some(e=>e.sourceElesisBloodCutter&&e.hitCount>0),180);
 const e=f.sim.state.effects.find(e=>e.sourceElesisBloodCutter&&e.hitCount>0),point=[e.x,e.y,e.z];
 for(let i=0;i<8;i++)step(f);
 assert.deepEqual([e.x,e.y,e.z],point);
 for(let i=0;i<150;i++)step(f);
 assert.ok(!f.sim.state.effects.some(v=>v.id===e.id));
});
for(const low of [false,true])test(`18 Brandish held extension pays HP at source .15 ticks, lowHP=${low}`,()=>{
 const f=elesisFixture('CA',{skillId:28022,gap:5000});
 if(low)f.a.hp=f.a.hpMax*.19;
 const initial=f.a.hp;step(f,['A'],['A']);
 for(let i=0;i<240;i++)step(f,['A']);
 const ticks=f.sim.state.events.filter(e=>e.type==='elesisBrandishExtended');
 assert.equal(ticks.length,6);
 if(low){assert.ok(ticks.every(t=>t.hpCost===0&&t.exempt));assert.equal(f.a.hp,initial);}
 else {assert.ok(ticks.every(t=>t.hpCost>0));assert.ok(f.a.hp<initial);}
 assert.equal(f.a.state,'RSI_WAIT');
});
test('18 Brandish release ends further HP payment and source low-HP gate stays bounded',()=>{
 const f=elesisFixture('CA',{skillId:28022,gap:5000});step(f,['A'],['A']);
 for(let i=0;i<240&&!f.sim.state.events.some(e=>e.type==='elesisBrandishExtended');i++)step(f,['A']);
 const count=f.sim.state.events.filter(e=>e.type==='elesisBrandishExtended').length;
 for(let i=0;i<120;i++)step(f);
 assert.equal(f.sim.state.events.filter(e=>e.type==='elesisBrandishExtended').length,count);
});
test('22 Firewall Useful applies exact declared .55 interval and .6 per-hit damage',async()=>{
 const {createSkillTraitPolicy,skillTraitDamageData}=await import(pathToFileURL(resolve(sourceRoot,'packages/combat-core/skill-traits.mjs')));
 const f=elesisFixture('BH',{skillId:28018,gap:5000}),row=f.profile.skillCatalog.find(s=>s.skillId===28018);
 const policy=createSkillTraitPolicy(row,'memo-64');
 assert.equal(policy.hitGapMultiplier,.55);assert.equal(policy.damageMultiplier,.6);
 const data=skillTraitDamageData(f.profile.damageEffects.DamageEffect_Wall_of_Prominence_Attack_Main.raw.DAMAGE_DATA,policy);
 assert.equal(data.HIT_GAP,.55);assert.equal(f.profile.damageEffects.DamageEffect_Wall_of_Prominence_Attack_Main.raw.DAMAGE_DATA.HIT_GAP,1);
});
test('23 Avatar original .01 scan consumes prior flames before its later Burn application',()=>{
 const f=elesisFixture('BH',{skillId:28208,gap:100,passives:[]});f.a.mp=100;
 f.sim.grantBuff(f.a,f.b,294,1);f.sim.grantBuff(f.a,f.b,301,1);assert.ok(f.b.buffs.some(b=>b.templateId===293));
 step(f,['A'],['A']);for(let i=0;i<80;i++)step(f);
 const events=f.sim.state.events.filter(e=>e.type==='elesisFireAbsorbed');assert.equal(events.length,1);
 assert.deepEqual(events[0].removedTemplateIds.sort((a,b)=>a-b),[37,293]);
 assert.equal(events[0].mp,20);assert.ok(f.a.mp>110);
 assert.ok(!f.b.buffs.some(b=>b.templateId===293));assert.ok(f.b.buffs.some(b=>b.templateId===37),'later source Burn is a separate effect, not another absorption');
});
