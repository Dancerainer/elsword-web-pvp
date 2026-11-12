/** Real Add callbacks, frozen target tables, original Native value kernels
 * and posed projectile/defender helpers. No source-notice verdict can stand
 * in for the receiving owner's current combat. Root runs Native serially. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addTargetSkillEvents} from '../../packages/combat-core/add-target-skills.mjs';
import {receiveAddTargetNotice} from '../../packages/combat-core/add-target-notices.mjs';
import {addDroneMarkContact,ADD_DRONE_MARK_PROJECTILE} from '../../packages/combat-core/add-drone-mark.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {applyAddTimeRing,tryAddTimeRingRevive} from '../../packages/combat-core/add-systems.mjs';
import {markAddStigma,returnAddStigma,receiveAddStigmaNotice} from '../../packages/combat-core/add-stigma.mjs';

function fixture(profession,skillId,{version=1,owner='target'}={}){
  const f=originalAddFixture(profession,{skillId,networkOwnerId:owner});
  f.sim.networkCombatPlaybackVersion=version;f.sim.networkEpochFor=()=>1;
  f.a.skillId=f.a.loadout[0].skillId;f.a.mp=f.a.mpMax;f.b.mp=50;f.b.x=250;
  return f;
}
function event(f){
  const skill=f.profile.skillCatalog.find(skill=>skill.skillId===f.a.skillId);
  f.sim.enter(f.a,skill.state,'current-playback-native-callback');
  f.a.animationTime=.272;f.a.stateTime=.272;
  addTargetSkillEvents(f.sim,f.a,.270,.272);
}

test('new room ignores a valid Force Finger owner notice; old room retains its existing once-only resource transfer',()=>{
  for(const version of [0,1]){
    const source=fixture('DE',29215,{owner:'add',version}),to=fixture('DE',29215,{version});
    source.a.sourceAddTargetNotice={serial:1,kind:'force-finger',skillId:29215,targets:[{id:'target',epoch:1}]};
    const report=validateOwnedState(encodeOwnedState(source.sim,'add',{epoch:1,frameSeq:4}));
    validateOwnedReferences(report,to.a,to.profile,to.sim.map,{profiles:to.sim.profiles,actors:to.sim.state.actors});
    const before=structuredClone(to.b);applyOwnedState(to.sim,'add',report);
    if(version===1)assert.deepEqual(to.b,before,'even a strictly valid source result cannot alter the current owner');
    else assert.equal(to.b.mp,before.mp-15);
    const mp=to.b.mp;applyOwnedState(to.sim,'add',report);assert.equal(to.b.mp,mp);
  }
});

test('new room ignores a valid MM acquired-mark notice, including before the local projectile has touched',()=>{
  const f=fixture('MM',29013);const before=structuredClone(f.b);
  const notice={serial:1,kind:'drone-activator',skillId:f.a.skillId,targets:[{id:'target',epoch:1}],remaining:Math.fround(Math.fround(4.9)*1.5)};
  assert.equal(receiveAddTargetNotice(f.sim,f.a,1,notice),false);assert.deepEqual(f.b,before);
});

for(const protection of ['none','invincible','force','room'])test(`current remote Force Finger playback ${protection} settles only the receiving owner once`,()=>{
  const f=fixture('DE',29215);const other={...structuredClone(f.b),id:'other',x:300,mp:77};f.sim.state.actors.push(other);
  if(protection==='invincible')f.b.invincible=true;if(protection==='force')f.b.forceInvincible=.5;
  if(protection==='room')f.b.pvpInvincibleRemaining=.5;
  const before=structuredClone(f.b),sourceMp=f.a.mp;event(f);
  assert.equal(f.b.mp,protection==='none'?before.mp-15:before.mp);assert.equal(other.mp,77,'a foreign nonowner cannot lose resources on this browser');
  assert.equal(f.a.mp,sourceMp,'this receiver cannot award the remote caster resources');
  const settled=structuredClone(f.b);addTargetSkillEvents(f.sim,f.a,.270,.272);assert.deepEqual(f.b,settled,'the local callback identity is consumed once');
});

for(const protection of ['none','invincible','force','room'])test(`current remote Mind Break playback ${protection} uses current owner protection before installing its Buff`,()=>{
  const f=fixture('DE',29214);if(protection==='invincible')f.b.invincible=true;if(protection==='force')f.b.forceInvincible=.5;
  if(protection==='room')f.b.pvpInvincibleRemaining=.5;
  const before=structuredClone(f.b);event(f);
  if(protection==='none'){
    const buff=f.b.buffs.find(buff=>buff.templateId===328);assert.ok(buff);assert.equal(buff.factorId,347);
    assert.equal(buff.behaviors.find(row=>row.stat==='magicAttack').value,Math.fround(.68));
  }else assert.deepEqual(f.b,before,'blocked local application must not import a source-side Buff verdict');
});

test('source-owned Force Finger retains its immediate local recovery without writing any remote recipient MP',()=>{
  const f=fixture('DE',29215,{owner:'add'});f.a.mp=20;const targetMp=f.b.mp;event(f);
  const skill=f.profile.skillCatalog.find(skill=>skill.skillId===29215);
  assert.equal(f.a.mp,20+skill.raw.SA_MP_RETAKE_ABS[skill.maxLevel]);assert.equal(f.b.mp,targetMp);
  assert.equal(f.a.sourceAddTargetNotice,undefined);
});

function posedMark(){
  const f=fixture('MM',29013);f.b.x=10000;
  const effect=f.sim.createEffect(f.a,{NAME:ADD_DRONE_MARK_PROJECTILE,BONE_NAME:'Bip01_L_Hand'});
  f.sim.tickEffects(1/60);assert.equal(effect.active,true);assert.ok(f.sim.state.effects.includes(effect));
  const attack=f.sim.effectSampler(effect,f.a,{profile:f.profile}).find(shape=>shape.kind==='sphere'&&shape.radius>0);
  const defender=f.sim.defenderSampler(f.b,{profile:f.profile,role:'defender'}).find(shape=>shape.kind==='sphere'&&shape.radius>0);
  assert.ok(attack?.center&&defender?.center,'both original posed helper spheres are available');
  for(const [index,key]of ['x','y','z'].entries())f.b[key]+=attack.center[index]-defender.center[index];
  assert.equal(f.sim.intersects(attack,f.b),true);
  return {...f,effect,attack,hit(){return f.sim.checkHits(f.a,[attack],structuredClone(effect.damage.DAMAGE_DATA),effect.hits,
    {kind:'effect',id:effect.id,skillId:effect.skillId,powerMultiplier:effect.powerMultiplier,impactPoint:[...attack.center]});}};
}

test('actual receiving-owner Native RT11 projectile contact installs the original mark once through the core hook',()=>{
  const f=posedMark();assert.equal(f.b.buffs.some(buff=>buff.templateId===344),false);assert.equal(f.hit(),1);
  const buff=f.b.buffs.find(buff=>buff.templateId===344);assert.ok(buff);assert.equal(buff.factorId,370);
  assert.equal(buff.behaviors.find(row=>row.stat==='physicalDefence').value,Math.fround(.785));
  assert.equal(f.effect.sourceAddDroneMarkAccepted,true);const before=structuredClone(f.b);assert.equal(f.hit(),0);assert.deepEqual(f.b,before);
  assert.equal(f.a.sourceAddTargetNotice,undefined,'no source-side claimed recipient result was needed');
});

test('current local invulnerability refuses an actual Native Drone contact; clearing it later allows a genuinely new local contact',()=>{
  const f=posedMark();f.b.invincible=true;f.b.forceInvincible=.5;const before=structuredClone(f.b);
  assert.equal(f.hit(),0);assert.deepEqual(f.b,before);assert.equal(f.effect.sourceAddDroneMarkAccepted,undefined);
  f.b.invincible=false;f.b.forceInvincible=0;assert.equal(f.hit(),1);assert.ok(f.b.buffs.some(buff=>buff.templateId===344));
});

test('source-owned MM acquisition keeps its immediate mark/visual control while recipient Buff waits for its own collision',()=>{
  const f=fixture('MM',29013,{owner:'add'}),effect=f.sim.createEffect(f.a,{NAME:ADD_DRONE_MARK_PROJECTILE});
  const before=structuredClone(f.b);assert.equal(addDroneMarkContact(f.sim,f.a,f.b,effect),true);
  assert.ok(f.a.sourceAddDroneMark);assert.equal(f.a.sourceAddDroneMark.targetId,f.b.id);
  assert.ok(f.sim.state.effects.some(effect=>effect.sourceAddDroneMarkVisual));assert.deepEqual(f.b,before);
  assert.equal(f.a.sourceAddTargetNotice,undefined);
});

test('a valid Time Ring source notice does not grant a seal or reduce local cooldowns in a playback room',()=>{
  const source=fixture('DE',29213,{owner:'add'}),to=fixture('DE',29213);source.b.team=to.b.team=0;
  source.a.sourceTimeRingNotice={serial:1,remaining:16.5,position:[0,3080,0],skillId:29213};
  to.b.cooldowns[29000]=30;const before=structuredClone(to.b);
  const report=validateOwnedState(encodeOwnedState(source.sim,'add',{epoch:1,frameSeq:5}));
  validateOwnedReferences(report,to.a,to.profile,to.sim.map,{actors:to.sim.state.actors,profiles:to.sim.profiles});
  applyOwnedState(to.sim,'add',report);assert.deepEqual(to.b,before);
});

test('current remote Time Ring callback saves the recipient current resources and preserves the original beneficial invulnerability rule',()=>{
  const f=fixture('DE',29213);f.b.team=0;f.b.invincible=true;f.b.hp=f.b.hpMax*.4;f.b.mp=41;
  f.b.sourceAdd.dp=1234;f.b.cooldowns[29000]=30;
  const skill=f.profile.skillCatalog.find(skill=>skill.skillId===29213);
  assert.equal(applyAddTimeRing(f.sim,f.a,skill),1);assert.equal(f.b.sourceTimeRing.hp,f.b.hp);assert.equal(f.b.sourceTimeRing.mp,41);
  assert.equal(f.b.sourceTimeRing.dp,1234);assert.equal(f.b.cooldowns[29000],6);assert.equal(f.a.sourceTimeRingNotice,undefined);
  f.b.hp=0;f.b.mp=1;f.b.sourceAdd.dp=1;assert.equal(tryAddTimeRingRevive(f.sim,f.b),true);
  assert.equal(f.b.hp,f.b.hpMax*.4);assert.equal(f.b.mp,41);assert.equal(f.b.sourceAdd.dp,1234);assert.equal(f.b.sourceTimeSickness,120);
});

test('local Stigma playback records this browser target point; later owner snapshots and notice claims cannot replace it',()=>{
  const source=fixture('DE',29025,{owner:'add'}),to=fixture('DE',29025);
  source.b.x=150;assert.equal(markAddStigma(source.sim,source.a,source.b),true);
  const localPoint=[to.b.x,to.b.y,to.b.z];assert.equal(markAddStigma(to.sim,to.a,to.b),true);
  assert.ok(to.b.buffs.some(buff=>buff.templateId===440));assert.equal(to.a.sourceAddStigma,undefined,'recipient mark lives outside source-owned actor fields');
  const ledger=structuredClone(to.sim.state.localOwnerAddPlaybackStigma);
  to.b.x=900;const before=structuredClone(to.b);
  const report=validateOwnedState(encodeOwnedState(source.sim,'add',{epoch:1,frameSeq:10}));
  validateOwnedReferences(report,to.a,to.profile,to.sim.map,{actors:to.sim.state.actors,profiles:to.sim.profiles});
  applyOwnedState(to.sim,'add',report);
  assert.deepEqual(to.b,before);assert.deepEqual(to.sim.state.localOwnerAddPlaybackStigma,ledger);
  const claim={serial:99,action:'return',...structuredClone(source.a.sourceAddStigma),remaining:0};
  assert.equal(receiveAddStigmaNotice(to.sim,to.a,1,claim),false);assert.deepEqual(to.b,before);
  assert.equal(returnAddStigma(to.sim,to.a),true);assert.deepEqual([to.b.x,to.b.y,to.b.z],localPoint);
  assert.notEqual(to.b.x,source.b.x,'the source remembered point is not the recipient remembered point');
});

for(const gate of ['unseen','invincible','life'])test(`local Stigma ${gate} refuses a claimed or no-longer-valid return`,()=>{
  const f=fixture('DE',29025);if(gate!=='unseen')assert.equal(markAddStigma(f.sim,f.a,f.b),true);
  f.a.sourceAddStigma={skillId:29025,targetId:'target',targetEpoch:1,position:[-1200,3080,0],lineId:2,remaining:6,group:999};
  f.b.x=900;if(gate==='invincible')f.b.forceInvincible=.5;
  if(gate==='life')f.sim.networkEpochFor=id=>id==='target'?2:1;
  const point=[f.b.x,f.b.y,f.b.z];assert.equal(returnAddStigma(f.sim,f.a),false);assert.deepEqual([f.b.x,f.b.y,f.b.z],point);
});
