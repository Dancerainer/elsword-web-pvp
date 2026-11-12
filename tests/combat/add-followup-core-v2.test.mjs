/** Real core input, original target tables/WASM/map/converted poses and owner
 * envelopes. Explicit RT11 contacts exercise the callback boundary; they are
 * not target-client collision traces or verification of the missing launcher.
 * ADD_CORE_FIXTURE_ROOT selects a read-only integration worktree; report output
 * is opt-in and must be placed in the calling task's own output directory. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ownRoot=fileURLToPath(new URL('../../',import.meta.url));
const runtimeRoot=path.resolve(process.env.ADD_CORE_FIXTURE_ROOT??ownRoot);
const imp=p=>import(pathToFileURL(path.join(runtimeRoot,p)));
const [{addFixture},{syncAddAwakening},{markAddStigma},{ADD_DRONE_MARK_PROJECTILE},
  wire,{PROFESSION_PROFILES},{createNativeSamplers,mergeEffectIndexes},{composeCharacterPose},{createProfessionSamplers}]=await Promise.all([
  imp('tests/helpers/add-fixture.mjs'),imp('packages/combat-core/add-systems.mjs'),imp('packages/combat-core/add-stigma.mjs'),
  imp('packages/combat-core/add-drone-mark.mjs'),imp('packages/online/owned-state.mjs'),imp('packages/professions/profiles.mjs'),
  imp('packages/combat-assets/index.mjs'),imp('packages/combat-assets/shared-character.mjs'),imp('packages/combat-assets/profession-samplers.mjs')]);
const read=p=>JSON.parse(readFileSync(path.join(runtimeRoot,p)));
const hash=p=>createHash('sha256').update(readFileSync(path.join(runtimeRoot,p))).digest('hex');
const sourceFiles=['tests/helpers/add-fixture.mjs','packages/combat-core/index.mjs','packages/online/owned-state.mjs',
  'packages/combat-core/add-systems.mjs','packages/combat-core/add-recasts.mjs','packages/combat-core/add-stigma.mjs',
  'packages/combat-core/add-drone-mark.mjs','packages/combat-core/add-target-notices.mjs','packages/combat-core/add-target-skills.mjs',
  'packages/combat-core/add-skills.mjs','packages/combat-core/buffs.mjs','packages/combat-core/mm-profile.json',
  'packages/combat-core/de-profile.json','packages/combat-core/lk-profile.json','artifacts/native/manifest.json',
  'artifacts/common-buffs/catalog.json'];
const report={schemaVersion:2,evidenceClass:'current-web-core-integration-with-original-resource-inputs',targetClientMeasured:false,
  runtimeRoot,runtimeCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:runtimeRoot,encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(sourceFiles.map(p=>[p,hash(p)])),
  boundaries:['Source-derived skill values; exact-position Stigma recall is a Web adapter, not a measured 2016 displacement consumer.',
    'Explicit original-projectile contact injection validates real RT11 callback integration, not automatic Drone Activator firing or collision geometry.',
    'Visual source-closure warnings are reported separately and are never accepted as proof of complete shared FX.'],cases:[]};

const samplerCache={};
function samplersFor(id){
  if(samplerCache[id])return samplerCache[id];
  const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json'),raw=read(base+manifest.runtimePose);
  const characterPose=composeCharacterPose(raw,raw.sharedPose?read(base+raw.sharedPose):null);
  const visuals={templates:Object.assign({},...(manifest.visualEffectIndexes??[]).map(p=>read(base+p).templates))};
  const effectIndex=mergeEffectIndexes(read(base+manifest.effectAssetIndex),visuals);
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(base+p)]));
  return samplerCache[id]=createNativeSamplers({profile:PROFESSION_PROFILES[id],characterPose,effectIndex,effectPoses});
}
const samplers=createProfessionSamplers(Object.fromEntries(['DE','MM','LK'].map(id=>[id,samplersFor(id)])),'DE');
const keys={pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]};
const clone=v=>JSON.parse(JSON.stringify(v));
const f=Math.fround,dt=1/60;
const near=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const remaining=(a,id)=>a.buffs.find(b=>b.templateId===id)?.finalizers.find(x=>x.kind==='time')?.remaining;
const position=a=>[a.x,a.y,a.z];
let activeCase;
function fixture(profession='DE',options={}){
  const out=addFixture(profession,{skillId:profession==='DE'?29025:29035,targetProfession:'LK',samplers,...options});
  out.sim.networkEpochFor=()=>3;activeCase.fixtures.push(out);return out;
}
function check(name,fn){test(name,()=>{
  const row={name,passed:false,observations:{},warnings:[]};report.cases.push(row);activeCase={row,fixtures:[]};
  try{fn(row.observations);row.passed=true;}catch(error){row.failure=error.stack;throw error;}
  finally{row.warnings=[...new Set(activeCase.fixtures.flatMap(({sim})=>sim.state.events.filter(e=>e.type==='unsupported').map(e=>e.id)))].sort();}
});}
function packet(sim,id='add',frame=1){
  const value=wire.validateOwnedState(clone(wire.encodeOwnedState(sim,id,{epoch:3,frameSeq:frame})));
  references(sim,id,value);return value;
}
function references(sim,id,value){wire.validateOwnedReferences(value,sim.actor(id),sim.profileFor(sim.actor(id)),sim.map,{actors:sim.state.actors,profiles:sim.profiles});}
function deliver(from,to,frame=1){const value=packet(from,'add',frame);references(to,'add',value);wire.applyOwnedState(to,'add',value,{endMissing:true});return value;}
function initialStigma(out){
  const {sim,a,b}=out;a.mp=300;sim.processInput(a,keys);
  assert.equal(a.state,'ANSI_SA_ADE_REVERSE_STIGMA');
  sim.processStateEvents(a,0,.11);
  assert.equal(a.sourceAddStigma?.targetId,b.id,'actual initial .1 target scan establishes the mark');
  assert.equal(a.sourceAddStigmaNotice.action,'mark');
  return clone(a.sourceAddStigma);
}
function prepareRecall(out,{formed=false,dp=1000}={}){
  const {sim,a}=out;sim.enter(a,'RSI_WAIT','qa-isolate-recast-input');
  a.mp=80;a.sourceAdd.dp=dp;a.sourceAdd.formation=formed;a.sourceAdd.formationPending=false;a.sourceAdd.mutation=3;
  syncAddAwakening(a);a.cooldowns[29025]=8;
}
function recall(out){
  const {sim,a}=out;sim.processInput(a,keys);assert.equal(a.state,'ANSI_SA_ADE_REVERSE_STIGMA_RETURN');
  sim.processStateEvents(a,0,.11);assert.equal(a.sourceAddStigmaNotice.action,'return');
}
function buffIdentity(buff,caster,target,factor,template){
  assert.ok(buff);assert.equal(buff.factorId,factor);assert.equal(buff.templateId,template);
  assert.equal(buff.sourceActorId,caster.id);assert.equal(buff.targetActorId,target.id);
}
function projectileContact(out){
  const {sim,a,b}=out;a.skillId=29035;
  const projectile=sim.createEffect(a,{NAME:ADD_DRONE_MARK_PROJECTILE});
  assert.equal(projectile.damage.DAMAGE_DATA.REACT_TYPE,11);
  const result=sim.createReactionEffect(a,b,projectile.damage.DAMAGE_DATA,
    {kind:'effect',id:projectile.id,skillId:29035,powerMultiplier:1,impactPoint:position(b)});
  assert.equal(result.accepted,true);assert.equal(result.effectTrigger,true);
  const child=sim.state.effects.find(e=>e.parentEffectId===projectile.id&&e.name==='DamageEffect_Drone_Activator_Loop_Explosion');
  assert.ok(child,'real RT11 consumer emits original impact child');
  assert.equal(projectile.sourceAddDroneMarkAccepted,true);return {projectile,child};
}
function assertDroneBuff(out,baseline){
  const buff=out.b.buffs.find(b=>b.templateId===344);buffIdentity(buff,out.a,out.b,370,344);
  assert.equal(buff.finalizers.find(x=>x.kind==='time').sourceDuration,f(f(4.9)*f(1.5)));
  for(const stat of ['physicalDefence','magicDefence']){
    const behavior=buff.behaviors.find(b=>b.stat===stat);assert.equal(behavior.changeType,3);assert.equal(behavior.value,f(.785));
    assert.equal(out.b.stats[stat],f(baseline[stat]*f(.785)));
  }
  return buff;
}

for(const [label,formed,dp]of [['ordinary',false,1000],['formed',true,1000],['formed final 200 raw DP',true,200]])
check('Stigma '+label+' actual recast pays once without cooldown/mutation/base-resource repeats',observation=>{
  const out=fixture(),{sim,a}=out;initialStigma(out);prepareRecall(out,{formed,dp});
  const availability=sim.skillAvailability(a.id,0);assert.equal(availability.available,true);assert.equal(availability.mode,'stigma-return');
  assert.equal(availability.mpCost,formed?0:20);assert.equal(availability.addResourcePlan.dpCost,formed?200:0);
  assert.equal(availability.addResourcePlan.mutationCost,0);assert.equal(availability.cooldown,0);
  sim.processInput(a,keys);assert.equal(a.state,'ANSI_SA_ADE_REVERSE_STIGMA_RETURN');
  assert.equal(a.mp,formed?80:60);assert.equal(a.sourceAdd.dp,formed?dp-200:dp);assert.equal(a.sourceAdd.mutation,3);
  assert.equal(a.cooldowns[29025],8);const afterPayment=clone(a.sourceAdd);
  const instant=packet(sim);assert.ok(instant);
  if(dp===200){assert.equal(a.sourceAdd.formation,false);assert.equal(a.sourceAdd.formationPending,false);assert.equal(a.awakening.remaining,0);}
  sim.processStateEvents(a,0,.11);sim.processStateEvents(a,0,.11);
  assert.deepEqual(a.sourceAdd,afterPayment);assert.equal(a.mp,formed?80:60);assert.equal(a.cooldowns[29025],8);
  assert.equal(a.sourceAddStigmaNotice.action,'return');packet(sim);
  observation.resources={mp:a.mp,dp:a.sourceAdd.dp,mutation:a.sourceAdd.mutation,cooldown:a.cooldowns[29025],formation:a.sourceAdd.formation};
});

check('Stigma cross-LK recipient requires the saved mark, returns once and immediately encodes valid owned state',observation=>{
  const sender=fixture('DE',{networkOwnerId:'add'}),receiver=fixture('DE',{networkOwnerId:'target'});
  const saved=initialStigma(sender);assert.equal(sender.b.buffs.some(b=>b.templateId===440),false,'sender does not write remote recipient buffs');
  const markPacket=deliver(sender.sim,receiver.sim);buffIdentity(receiver.b.buffs.find(b=>b.templateId===440),receiver.a,receiver.b,478,440);
  packet(receiver.sim,'target');
  const snapshot=clone(receiver.sim.snapshot()),restored=fixture('DE',{networkOwnerId:'target'});restored.sim.restore(snapshot);
  assert.deepEqual(restored.sim.state.localOwnerAddStigmaReceipts,receiver.sim.state.localOwnerAddStigmaReceipts);
  for(const sim of [receiver.sim,restored.sim]){const target=sim.actor('target');target.x+=300;target.y+=25;}
  prepareRecall(sender);recall(sender);const returnPacket=deliver(sender.sim,receiver.sim,2);
  references(restored.sim,'add',returnPacket);wire.applyOwnedState(restored.sim,'add',returnPacket,{endMissing:true});
  for(const sim of [receiver.sim,restored.sim]){
    const local=sim.actor('target');assert.deepEqual(position(local),saved.position);assert.equal(local.grounded,false);assert.equal(local.lineId,null);
    assert.equal(local.lastTouchLineId,saved.lineId);assert.ok(local.landPosition.length===3&&local.landPosition.every(Number.isFinite));
    assert.equal(local.buffs.some(b=>b.templateId===440),false);packet(sim,'target',2);
    local.x+=77;wire.applyOwnedState(sim,'add',returnPacket,{endMissing:true});assert.equal(local.x,saved.position[0]+77,'duplicate cannot return again');
  }
  const unmarked=fixture('DE',{networkOwnerId:'target'});unmarked.b.x=999;
  references(unmarked.sim,'add',returnPacket);wire.applyOwnedState(unmarked.sim,'add',returnPacket,{endMissing:true});assert.equal(unmarked.b.x,999);
  const laterLife=fixture('DE',{networkOwnerId:'target'});wire.applyOwnedState(laterLife.sim,'add',markPacket,{endMissing:true});
  laterLife.sim.networkEpochFor=id=>id==='target'?4:3;laterLife.b.x=777;
  wire.applyOwnedState(laterLife.sim,'add',returnPacket,{endMissing:true});assert.equal(laterLife.b.x,777,'old position is not applied to a new life');
  observation.saved=saved;observation.immediateRecipientBytes=Buffer.byteLength(JSON.stringify(packet(receiver.sim,'target',3)));
});

check('Stigma newer different-target mark removes old recipient 440 when its clear was coalesced',observation=>{
  const sender=fixture('DE',{networkOwnerId:'add'}),receiver=fixture('DE',{networkOwnerId:'target'});
  for(const out of [sender,receiver]){const other=structuredClone(out.b);other.id='other';other.x+=50;other.buffs=[];out.sim.state.actors.push(other);}
  initialStigma(sender);deliver(sender.sim,receiver.sim);assert.ok(receiver.b.buffs.some(b=>b.templateId===440));
  const previous=sender.a.sourceAddStigmaNotice.serial;sender.a.stateSerial++;
  assert.equal(markAddStigma(sender.sim,sender.a,sender.sim.actor('other')),true);
  assert.equal(sender.a.sourceAddStigmaNotice.serial,previous+2,'intermediate clear followed by replacement mark');
  const latest=deliver(sender.sim,receiver.sim,2);assert.equal(latest.actor.sourceAddStigmaNotice.action,'mark');
  assert.equal(receiver.b.buffs.some(b=>b.templateId===440),false);assert.equal(receiver.sim.state.localOwnerAddStigmaReceipts.owners[0].mark,null);
  packet(receiver.sim,'target');observation.replacementSerial=latest.actor.sourceAddStigmaNotice.serial;
});

check('Stigma receipt follows stopped caster time while recipient buff uses global time',observation=>{
  const sender=fixture('DE',{networkOwnerId:'add'}),receiver=fixture('DE',{networkOwnerId:'target'});
  initialStigma(sender);deliver(sender.sim,receiver.sim);receiver.a.worldStop=1;receiver.b.worldStop=1;
  // The initial original damage also applies BF478 on collision. Finish that
  // injected contact's damaging instances to isolate the two timer domains;
  // an unconsumed first hit would legitimately refresh the six-second buff.
  for(const effect of receiver.sim.state.effects)if(effect.damage)effect.dead=true;
  const mark=receiver.a.sourceAddStigma.remaining,receipt=receiver.sim.state.localOwnerAddStigmaReceipts.owners[0].mark.remaining;
  const buff=remaining(receiver.b,440);receiver.sim.step(dt,{}, {snapshot:false});
  assert.equal(receiver.a.sourceAddStigma.remaining,mark);assert.equal(receiver.sim.state.localOwnerAddStigmaReceipts.owners[0].mark.remaining,receipt);
  near(remaining(receiver.b,440),f(buff-dt));packet(receiver.sim,'target');observation.remaining={mark,receipt,buff:remaining(receiver.b,440)};
});

check('MM 29035 actual RT11 projectile callback marks and applies both defenses; original explosion cannot mark',observation=>{
  const out=fixture('MM'),baseline=structuredClone(out.b.stats);const {projectile,child}=projectileContact(out);
  assert.equal(out.a.sourceAddDroneMark.remaining,f(f(4.9)*f(1.5)));assertDroneBuff(out,baseline);
  const serial=out.a.sourceAddTargetNotice.serial;
  out.sim.createReactionEffect(out.a,out.b,projectile.damage.DAMAGE_DATA,{kind:'effect',id:projectile.id,skillId:29035,powerMultiplier:1,impactPoint:position(out.b)});
  assert.equal(out.a.sourceAddTargetNotice.serial,serial,'same projectile contact cannot refresh mark notice');packet(out.sim);packet(out.sim,'target');
  const explosionOnly=fixture('MM');explosionOnly.a.skillId=29035;
  const explosion=explosionOnly.sim.createEffect(explosionOnly.a,{NAME:child.name});assert.equal(explosion.damage.DAMAGE_DATA.REACT_TYPE,2);
  const hit=explosionOnly.sim.applyHit(explosionOnly.a,explosionOnly.b,explosion.damage.DAMAGE_DATA,
    {kind:'effect',id:explosion.id,skillId:29035,powerMultiplier:1,impactPoint:position(explosionOnly.b)});
  assert.equal(hit.accepted,true);assert.equal(explosionOnly.a.sourceAddDroneMark,undefined);
  assert.equal(explosionOnly.a.sourceAddTargetNotice,undefined);assert.equal(explosionOnly.b.buffs.some(b=>b.templateId===344),false);
  observation.defenses={physical:out.b.stats.physicalDefence,magic:out.b.stats.magicDefence};observation.originalExplosionDamage=hit.amount;
});

check('MM mark reaches LK recipient with complete buff identity, survives wire/snapshot and never refreshes on duplicate',observation=>{
  const sender=fixture('MM',{networkOwnerId:'add'}),receiver=fixture('MM',{networkOwnerId:'target'}),baseline=structuredClone(receiver.b.stats);
  projectileContact(sender);assert.equal(sender.b.buffs.some(b=>b.templateId===344),false);
  const sent=deliver(sender.sim,receiver.sim);assertDroneBuff(receiver,baseline);const local=packet(receiver.sim,'target');
  const observer=fixture('MM',{networkOwnerId:'add'});references(observer.sim,'target',local);wire.applyOwnedState(observer.sim,'target',local,{endMissing:true});
  assert.deepEqual(observer.b.buffs,local.actor.buffs,'all wire fields restore; local provenance annotations are intentionally not transmitted');
  assert.equal(observer.b.buffs[0].sourceActorId,'add');
  const snapshot=clone(receiver.sim.snapshot()),restored=fixture('MM',{networkOwnerId:'target'});restored.sim.restore(snapshot);
  assert.deepEqual(restored.sim.state.localOwnerAddTargetReceipts,receiver.sim.state.localOwnerAddTargetReceipts);
  const rb=restored.sim.actor('target'),timer=rb.buffs.find(b=>b.templateId===344).finalizers.find(e=>e.kind==='time');timer.remaining=2;
  wire.applyOwnedState(restored.sim,'add',sent,{endMissing:true});assert.equal(timer.remaining,2,'retained notice cannot renew original duration');
  const invalid=clone(local);invalid.actor.buffs.find(b=>b.templateId===344).sourceActorId='missing-source';
  assert.throws(()=>references(observer.sim,'target',invalid));observation.ownerPacketBytes=Buffer.byteLength(JSON.stringify(sent));
  observation.recipientBuff=clone(receiver.b.buffs.find(b=>b.templateId===344));
});

check('MM mark, notice and defender buff age in global dt during world stop',observation=>{
  const out=fixture('MM');projectileContact(out);out.a.worldStop=1;out.b.worldStop=1;
  const before=out.a.sourceAddDroneMark.remaining,animation=out.a.animationTime;
  out.sim.step(dt,{}, {snapshot:false});
  assert.equal(out.a.animationTime,animation);assert.equal(out.a.sourceAddDroneMark.remaining,f(before-f(dt)));
  assert.equal(out.a.sourceAddTargetNotice.remaining,f(before-f(dt)));near(remaining(out.b,344),f(before-dt));
  packet(out.sim);packet(out.sim,'target');observation.remaining={mark:out.a.sourceAddDroneMark.remaining,notice:out.a.sourceAddTargetNotice.remaining,buff:remaining(out.b,344)};
});

after(()=>{
  report.passed=report.cases.every(row=>row.passed);report.caseCount=report.cases.length;
  report.sourceChangedDuringRun=sourceFiles.filter(p=>hash(p)!==report.sourceHashes[p]);
  report.sharedFxWarnings=[...new Set(report.cases.flatMap(row=>row.warnings).filter(id=>/buff-displayer-source-closure/.test(id)))];
  report.sharedFxClosure=report.sharedFxWarnings.length?'incomplete; warnings preserved, separate asset closure required':'no shared buff-source warning observed; renderer/GPU acceptance remains separate';
  if(process.env.ADD_CORE_REPORT)writeFileSync(process.env.ADD_CORE_REPORT,JSON.stringify(report,null,2)+'\n');
  assert.deepEqual(report.sourceChangedDuringRun,[],'runtime inputs changed during the run; rerun against a stable snapshot');
});
