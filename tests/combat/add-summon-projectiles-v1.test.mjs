/** Target declarations supply constants. Test contacts are synthetic and the
 * original VectorLockOn WASM is used for steering, not a copied JS formula. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
import {moveAddSummonProjectile,validateAddSummonProjectileState,isAddSummonProjectile} from '../../packages/combat-core/add-summon-projectiles.mjs';
const root=process.env.ADD_RUNTIME_ROOT??fileURLToPath(new URL('../../',import.meta.url));
const bridge=await instantiateNativeSkills(await WebAssembly.compile(readFileSync(path.join(root,'artifacts/native/skills.wasm'))));
const contract=JSON.parse(readFileSync(new URL('../../contracts/add-apocalypse-projectiles-v1.json',import.meta.url)));
function fixture(letter='B'){
 const name='DamageEffect_AMM_APOCALYPSE_Attack_'+letter+'_Projectile_PVP',source=contract.projectiles[name];
 const owner={id:'mm',professionId:'MM',team:0,hp:100,x:0,y:0,z:0},target={id:'enemy',team:1,hp:100,x:800,y:0,z:0};
 const profile={target:{unitClass:123},effectTemplates:{[source.template.name]:source.template},damageEffects:{[name]:{raw:source.raw}}};
 const calls=[],notes=[],sim={state:{actors:[owner,target]},profileFor:()=>profile,nativeSkills:{vectorLockOn(args){calls.push(structuredClone(args));return bridge.vectorLockOn(args);}},
  defenderSampler:a=>[{center:[a.x,a.y,a.z],radius:10}],note:(id)=>notes.push(id)};
 const e={name,skillId:29604,sourceAddSummonSerial:1,damage:source.raw,mainEffectName:source.template.name,
  initialDirSpeed:source.template.initialDirSpeed,hitCount:0,birthAnchor:{position:[0,0,0],rotation:[0,0,0],facing:1}};
 return {sim,owner,target,profile,e,calls,notes};
}
test('original target A and B use LOT6 with distinct curves, delays and mesh speeds',()=>{
 const a=fixture('A'),b=fixture('B');
 assert.deepEqual([a.e.damage.LOCK_ON_DATA.CURVE_SPEED,b.e.damage.LOCK_ON_DATA.CURVE_SPEED],[20,99]);
 assert.equal(a.e.damage.LOCK_ON_DATA.TIME_UNLOCK_FROM_START,.5);assert.equal(b.e.damage.LOCK_ON_DATA.TIME_UNLOCK_FROM_START,undefined);
 assert.deepEqual([a.e.initialDirSpeed,b.e.initialDirSpeed],[3000,1500]);
 assert.equal(a.e.damage.LOCK_ON_DATA.PVP_TARGET_RANGE_MIN_MAX['2'],9999);
});
test('mesh moves first; first selection does not steer; first ABI input retains creation angle',()=>{
 const {sim,owner,e,calls}=fixture();
 moveAddSummonProjectile(sim,e,owner,1/60);assert.ok(Math.abs(e.x-25)<.0001);assert.equal(e.sourceAddProjectile.targetId,'enemy');assert.equal(calls.length,0);
 moveAddSummonProjectile(sim,e,owner,1/60);assert.ok(Math.abs(e.x-50)<.0001);assert.equal(calls.length,1);assert.deepEqual(calls[0].manualDirDegree,[0,0,0]);
 const manual=[...e.sourceAddProjectile.manualDirDegree];
 assert.ok(manual[0]>90,'native curve99 overshoot is not normalized or clamped');
 moveAddSummonProjectile(sim,e,owner,1/60);assert.ok(Math.abs(e.x-91.25)<.0001,'next movement uses original unnormalized manual output');
});
test('nonzero creation Euler angle remains untouched during unlock delay',()=>{
 const {sim,owner,e,calls}=fixture('A');e.birthAnchor.rotation=[0,0,20];
 for(let n=0;n<5;n++)moveAddSummonProjectile(sim,e,owner,.125);
 assert.equal(calls.length,0);assert.deepEqual(e.sourceAddProjectile.manualDirDegree,[0,0,20]);
 moveAddSummonProjectile(sim,e,owner,.125);assert.equal(calls.length,1);assert.deepEqual(calls[0].manualDirDegree,[0,0,20]);
});
test('strict range and first equal-distance target follow fixed native selection',()=>{
 const {sim,owner,e,target}=fixture();target.x=10092.75;
 const twin={...target,id:'twin'},friend={...target,id:'friend',team:0,x:26},immune={...target,id:'immune',x:27,invincible:true};
 sim.state.actors.push(twin,friend,immune);moveAddSummonProjectile(sim,e,owner,.0625);
 assert.equal(e.sourceAddProjectile.targetId,null,'distance exactly9999 is outside strict original max');
 target.x=twin.x=10000;moveAddSummonProjectile(sim,e,owner,1/60);assert.equal(e.sourceAddProjectile.targetId,'enemy');
});
test('target collision point uses owner proximity and last tied bone; missing bones never use a guessed height',()=>{
 const {sim,owner,e,calls,notes}=fixture();
 sim.defenderSampler=()=>[{center:[0,20,0]},{center:[20,0,0]},{center:[30,0,0]}];
 moveAddSummonProjectile(sim,e,owner,1/60);moveAddSummonProjectile(sim,e,owner,1/60);
 assert.deepEqual(calls[0].targetPosition,[20,0,0]);
 sim.defenderSampler=()=>[];moveAddSummonProjectile(sim,e,owner,1/60);assert.equal(calls.length,1);
 assert.ok(notes.includes('add-apocalypse-projectile-target-pose'));
});
test('serialized manual direction and locked target resume through original ABI identically',()=>{
 const first=fixture('A');for(let i=0;i<39;i++)moveAddSummonProjectile(first.sim,first.e,first.owner,1/60);
 const other=fixture('A');other.e=JSON.parse(JSON.stringify(first.e));
 validateAddSummonProjectileState(other.e,{profile:other.profile,owner:other.owner,actors:other.sim.state.actors});
 for(let i=0;i<10;i++){moveAddSummonProjectile(first.sim,first.e,first.owner,1/60);moveAddSummonProjectile(other.sim,other.e,other.owner,1/60);}
 assert.deepEqual(other.e,first.e);
});
test('projectile wire rejects wrong profession, ally, identity, NaN and fabricated fields',()=>{
 const {sim,owner,e,profile}=fixture();moveAddSummonProjectile(sim,e,owner,1/60);
 const verify=v=>validateAddSummonProjectileState(v,{profile,owner,actors:sim.state.actors});verify(e);
 for(const alter of [v=>v.sourceAddProjectile.manualDirDegree[0]=NaN,v=>v.sourceAddProjectile.targetId='mm',
  v=>v.sourceAddProjectile.unknown=1,v=>v.sourceAddProjectile.delay=.5,v=>v.sourceAddSummonSerial=0,v=>v.name='unrelated']){
  const copy=structuredClone(e);alter(copy);assert.throws(()=>verify(copy),TypeError);
 }
 assert.throws(()=>validateAddSummonProjectileState(e,{profile:{...profile,target:{unitClass:122}}}),TypeError);
 assert.equal(isAddSummonProjectile({...e,skillId:29017}),false);
});
