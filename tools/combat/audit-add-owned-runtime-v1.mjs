/** Real Add/native resources, current Web observation only. Inputs under
 * ADD_RUNTIME_ROOT are read-only; outputs always belong to this task root. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const ownRoot=fileURLToPath(new URL('../../',import.meta.url));
const runtimeRoot=path.resolve(process.env.ADD_RUNTIME_ROOT??ownRoot);
const assetRoot=path.resolve(process.env.ADD_ASSET_ROOT??path.join(runtimeRoot,'artifacts'));
const imp=p=>import(pathToFileURL(path.join(runtimeRoot,p)));
const [{addFixture},{PROFESSION_PROFILES},{startAddFormation},{createNativeSamplers,mergeEffectIndexes},{composeCharacterPose},{createAddSummonSamplers},{loadAddSummonAssets}]=await Promise.all([
  imp('tests/helpers/add-fixture.mjs'),imp('packages/professions/profiles.mjs'),imp('packages/combat-core/add-systems.mjs'),
  imp('packages/combat-assets/index.mjs'),imp('packages/combat-assets/shared-character.mjs'),imp('packages/combat-assets/add-summon-samplers.mjs'),imp('packages/combat-assets/add-summon-assets.mjs')]);
const read=p=>JSON.parse(readFileSync(p.startsWith('artifacts/')?path.join(assetRoot,p.slice(10)):path.join(runtimeRoot,p))),sha=p=>createHash('sha256').update(readFileSync(path.join(runtimeRoot,p))).digest('hex');
const apocalypseAssets=await loadAddSummonAssets({base:'artifacts/mm/',data:read,profile:PROFESSION_PROFILES.MM});
const report={schemaVersion:1,evidenceClass:'current-web-native-resource-observation',targetClientMeasured:false,
  runtimeRoot,assetRoot,runtimeCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:runtimeRoot,encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-core/add-skills.mjs','packages/combat-core/add-systems.mjs',
    'packages/combat-core/lp-profile.json','packages/combat-core/mm-profile.json','packages/combat-core/de-profile.json',
    'packages/combat-core/add-summons.mjs','packages/combat-core/add-summon-damage.mjs','packages/combat-core/add-summon-projectiles.mjs',
    'packages/combat-assets/add-summon-samplers.mjs'].map(p=>[p,sha(p)])),
  filters:{profession:process.env.ADD_AUDIT_PROFESSION??null,skillId:Number(process.env.ADD_AUDIT_SKILL)||null},
  wireAdapterHashes:Object.fromEntries(['packages/online/owned-state.mjs','packages/combat-core/add-effect-state.mjs','packages/combat-core/add-summon-projectiles.mjs'].map(p=>[p,
    createHash('sha256').update(readFileSync(path.join(ownRoot,p))).digest('hex')])),
  conditions:'Supported top-tier active skills selected by the explicit filters above, in normal/formation, 720 frames each, source WASM, original Garpai collision and converted original bones/effect meshes. Full MP/DP/6 points are explicit QA inputs, not game defaults. Every frame is schema-checked, reference-checked, applied to a separately allocated receiver, and stepped; periodic full JSON snapshots are restored.',
  rows:[],checks:[],failures:0};
const dt=1/60;
const samplerCache=new Map();
function samplersFor(id){
  if(samplerCache.has(id))return samplerCache.get(id);
  const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json'),raw=read(base+manifest.runtimePose);
  const characterPose=composeCharacterPose(raw,raw.sharedPose?read(base+raw.sharedPose):null);
  const visuals={templates:Object.assign({},...manifest.visualEffectIndexes.map(file=>read(base+file).templates),...(id==='MM'?[apocalypseAssets.fxIndex.templates]:[]))};
  const effectIndex=mergeEffectIndexes(read(base+manifest.effectAssetIndex),visuals);
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(row=>row.poseData).filter(Boolean))].map(file=>[file,read(base+file)]));
  const samplers=createNativeSamplers({profile:PROFESSION_PROFILES[id],characterPose,effectIndex,effectPoses});
  if(id==='MM'){
    Object.assign(samplers,createAddSummonSamplers(apocalypseAssets));
  }
  samplerCache.set(id,samplers);return samplers;
}
function transfer(from,to,frame,{critical=false}={}){
  const packet=encodeOwnedState(from,'add',{epoch:1,frameSeq:frame});
  if(critical)packet.actions=[encodeCriticalAction(packet,{id:frame,frameSeq:frame})];
  const value=validateOwnedState(JSON.parse(JSON.stringify(packet))),actor=to.actor('add');
  validateOwnedReferences(value,actor,to.profileFor(actor),to.map,{profiles:to.profiles,actors:to.state.actors});
  applyOwnedState(to,'add',value);
  assert.deepEqual(to.actor('add').sourceAdd,from.actor('add').sourceAdd);
  assert.deepEqual(to.actor('add').sourceAddCombat,from.actor('add').sourceAddCombat);
  assert.deepEqual(to.actor('add').sourceAddSummon,from.actor('add').sourceAddSummon);
  for(const wire of packet.effects.filter(e=>e.sourceAddSummonPose)){
    const original=from.state.effects.find(e=>e.id===wire.id),restored=to.state.effects.find(e=>e.networkId===wire.id);
    assert.ok(restored,'all compact original NPC emitters restore');
    const geometry=a=>Object.fromEntries(['position','facing','rotation','matrix','customPosition'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
    assert.deepEqual(geometry(restored.birthAnchor),geometry(original.birthAnchor),'historical NPC Start birth geometry is preserved exactly');
    assert.deepEqual(restored.currentAnchor,original.currentAnchor,'current original NPC bone matrix is reconstructed exactly');
    assert.deepEqual(restored.sourcePosedAnchor,original.sourcePosedAnchor,'live particle attachment is reconstructed exactly');
    assert.equal(restored.definition.BONE_NAME,original.definition.BONE_NAME);
  }
  for(const e of from.state.effects.filter(e=>e.ownerId==='add'&&e.sourceAddProjectile!==undefined&&packet.effects.some(p=>p.id===e.id))){
    const other=to.state.effects.find(x=>x.ownerId==='add'&&x.networkId===e.id);
    assert.ok(other,'NPC projectile survives owner transfer');
    assert.deepEqual(other.sourceAddProjectile,e.sourceAddProjectile,'native steering direction and target survive wire');
  }
  for(const e of from.state.effects.filter(e=>e.ownerId==='add'&&e.sourceAddStormSize!==undefined&&packet.effects.some(p=>p.id===e.id))){
    const other=to.state.effects.find(x=>x.ownerId==='add'&&x.networkId===e.id);
    assert.ok(other,'scaled Storm instance survives owner transfer');
    assert.deepEqual(other.definition,e.definition,'Storm member identity, bone, offsets and collision/mesh scale survive wire');
  }
  return {bytes:Buffer.byteLength(JSON.stringify(packet)),effects:packet.effects.length};
}
function check(name,run){const row={name};report.checks.push(row);try{row.observation=run();row.passed=true;}catch(error){row.error=error.stack;row.passed=false;report.failures++;}console.log(name,row.passed?'ok':'FAIL '+row.error);}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.002,`${actual} != ${expected}`);
const frames=(sim,count,input={})=>{for(let i=0;i<count;i++)sim.step(dt,input,{snapshot:false});};
function resourceQa(){
  for(const id of ['LP','MM','DE'])check(id+' actual sourced command hit, separate DP frame gates, and pending formation',()=>{
    const {sim,a,b,profile}=addFixture(id,{samplers:samplersFor(id)}),receiver=addFixture(id,{samplers:samplersFor(id)});
    const data=structuredClone(profile.damageEffects.DamageEffect_AN_Combo_Z.raw.DAMAGE_DATA);
    assert.equal(data.DYNAMO_PARTICLE_RATE_TYPE,2);assert.equal(data.DAMAGE.PHYSIC,1.52);
    const result=sim.applyHit(a,b,data,{kind:'effect',powerMultiplier:1});assert.equal(result.accepted,true);
    // Target command coefficient 1.52 * command DP rate2 * normal hit40;
    // final equipment acquisition +50%. Receive uses actual accepted damage.
    near(a.sourceAdd.dp,182.4);near(b.sourceAdd.dp,result.amount/b.hpMax*12000);
    const first=[a.sourceAdd.dp,b.sourceAdd.dp];sim.applyHit(a,b,data,{kind:'effect',powerMultiplier:1});
    assert.deepEqual([a.sourceAdd.dp,b.sourceAdd.dp],first);frames(sim,1);
    a.sourceAdd.dp=4000;assert.equal(sim.tryAwakening(a),true);assert.equal(a.sourceAdd.formationPending,true);
    assert.equal(a.sourceAdd.formation,false);assert.equal(a.sourceAdd.mutation,1);near(a.sourceAdd.dp,3500);
    transfer(sim,receiver.sim,1);frames(sim,90);assert.equal(a.sourceAdd.formation,true);assert.equal(a.sourceAdd.formationPending,false);
    const before=a.sourceAdd.dp;sim.applyHit(a,b,data,{kind:'effect',powerMultiplier:1});near(before-a.sourceAdd.dp,60.8);
    return {damage:result.amount,initialDp:first,pendingEntryDp:3500,formedCommandDpSpent:before-a.sourceAdd.dp};
  });
  check('DE target Overlimit attack DP and formed on-hit / received MP use real core gates',()=>{
    const make=passives=>addFixture('DE',{samplers:samplersFor('DE'),passives});
    const plain=make([]),boosted=make([29410]);
    const data=structuredClone(boosted.profile.damageEffects.DamageEffect_AN_Combo_Z.raw.DAMAGE_DATA);
    assert.equal(boosted.a.passivePolicy.skillLevels[29410],4);
    boosted.sim.applyHit(boosted.a,boosted.b,data,{kind:'effect',powerMultiplier:1});near(boosted.a.sourceAdd.dp,200.64);
    const measures=[];
    for(const f of [plain,boosted]){
      f.a.sourceAdd.dp=4000;startAddFormation(f.a,{profile:f.profile});frames(f.sim,1);f.a.mp=0;
      f.sim.applyHit(f.a,f.b,data,{kind:'effect',powerMultiplier:1});const onHit=f.a.mp;
      frames(f.sim,1);f.a.mp=0;f.sim.applyHit(f.b,f.a,data,{kind:'effect',powerMultiplier:1});
      measures.push({onHit,received:f.a.mp});
    }
    assert.ok(measures[0].onHit>0&&measures[0].received>0);near(measures[1].onHit,measures[0].onHit*1.15);
    near(measures[1].received,measures[0].received*1.15);
    return {dissolutionAttackDp:200.64,plain:measures[0],overlimit:measures[1]};
  });
  check('DE Time Control formed natural MP recovers one extra per unfrozen second',()=>{
    const measures=[];
    for(const passives of [[],[29411]]){
      const f=addFixture('DE',{samplers:samplersFor('DE'),passives});
      f.a.sourceAdd.dp=4000;startAddFormation(f.a,{profile:f.profile});f.a.mp=0;frames(f.sim,60);
      measures.push(f.a.mp);
    }
    near(measures[1]-measures[0],1);return {plain:measures[0],timeControl:measures[1],difference:measures[1]-measures[0]};
  });
  check('DE accepted cast cooldown proc repeats exactly after seeded snapshot restore',()=>{
    const f=addFixture('DE',{skillId:29033,samplers:samplersFor('DE'),passives:[29411]});
    f.a.sourceAdd.dp=8000;const original=JSON.parse(JSON.stringify(f.sim.snapshot()));let observed=null;
    for(let seed=1;seed<=32&&!observed;seed++){
      const before=structuredClone(original);before.seed=seed;
      const cast=()=>{f.sim.restore(before);f.sim.drainEvents();f.sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});
        const events=f.sim.drainEvents();assert.equal(events.filter(e=>e.type==='skillStarted').length,1);
        return {seed:f.sim.state.seed,cooldown:f.sim.actor('add').cooldowns[29033],proc:events.filter(e=>e.type==='addTimeControlActivated')};};
      const first=cast(),replayed=cast();assert.deepEqual(replayed,first);
      if(first.proc.length){assert.equal(first.proc.length,1);const p=first.proc[0];near(p.after,p.before*.5);assert.ok(p.roll<.4);observed={inputSeed:seed,...first};}
    }
    assert.ok(observed,'at least one deterministic seed exercises successful target probability proc');return observed;
  });
  check('MM actual install / same-mode fire / different-mode switch and owner recovery',()=>{
    const f=addFixture('MM',{skillId:29035,samplers:samplersFor('MM')}),r=addFixture('MM',{skillId:29035,samplers:samplersFor('MM')});
    const switchId=[29016,29017,29018].find(id=>f.profile.skillCatalog.some(s=>s.skillId===id&&s.supported));
    const slots=[{skillId:29035},switchId?{skillId:switchId}:null,...Array(6).fill(null)];
    f.sim.configureLoadout(slots,'add');r.sim.configureLoadout(slots,'add');
    f.a.sourceAdd.dp=8000;const activate=key=>{f.sim.step(dt,{add:{pressed:[key],held:[key]}},{snapshot:false});f.sim.step(dt,{add:{released:[key],held:[]}},{snapshot:false});};
    activate('A');assert.equal(f.a.sourceAdd.generator.skillId,29035);assert.equal(f.a.sourceAdd.generator.phase,'ready');assert.equal(f.a.sourceAdd.mutation,0);
    const selected=f.a.sourceAdd.dp;frames(f.sim,240);const mp=f.a.mp;activate('A');assert.equal(f.a.sourceAdd.generator.phase,'firing');assert.ok(f.a.mp<mp-90);
    frames(f.sim,240);
    if(switchId){const mutation=f.a.sourceAdd.mutation;activate('S');assert.equal(f.a.sourceAdd.generator.skillId,switchId);assert.equal(f.a.sourceAdd.mutation,mutation+1);}
    else for(const id of [29016,29017,29018])assert.throws(()=>f.sim.configureLoadout([{skillId:id},...Array(7).fill(null)],'add'),/unimplemented/);
    transfer(f.sim,r.sim,500);assert.deepEqual(r.a.sourceAdd,f.a.sourceAdd);
    return {selectedDp:selected,final:f.a.sourceAdd,switchCoverage:switchId?'actual UI cast':'unavailable: other modes require unimplemented NPC consumers; independently covered only by resource module tests'};
  });
  for(const targetProfession of ['RF','LP'])check('DE actual time seal delivery to '+targetProfession+' and lethal owner interception',()=>{
    const opts={skillId:29213,targetProfession,targetTeam:0,samplers:samplersFor('DE')};
    const f=addFixture('DE',{...opts,networkOwnerId:'add'}),r=addFixture('DE',{...opts,networkOwnerId:'target'});
    f.a.sourceAdd.dp=8000;f.a.mp=f.a.mpMax;
    for(let frame=1;frame<=120;frame++){
      f.sim.step(dt,{add:frame===1?{pressed:['A'],held:['A']}:{held:[]}},{snapshot:false});
      transfer(f.sim,r.sim,frame);r.sim.step(dt,{}, {snapshot:false});
    }
    const local=r.b;assert.ok(local.sourceTimeRing,'actual .342 cast notice must reach local teammate');
    const stored=structuredClone(local.sourceTimeRing);assert.equal(stored.hp,local.hpMax*.5);
    local.hp=1;const attacker=r.a;attacker.team=1;
    const data=structuredClone(r.profile.damageEffects.DamageEffect_AN_Combo_Z.raw.DAMAGE_DATA);
    const epoch=local.networkFrameEpoch??null;const hit=r.sim.applyHit(attacker,local,data,{kind:'effect',powerMultiplier:1});assert.equal(hit.accepted,true);
    assert.equal(local.hp,stored.hp);assert.equal(local.sourceTimeRing,null);assert.equal(local.sourceTimeSickness,120);assert.equal(local.networkFrameEpoch??null,epoch);
    attacker.team=0;const packet=validateOwnedState(encodeOwnedState(r.sim,'target',{epoch:1,frameSeq:121}));
    validateOwnedReferences(packet,local,r.sim.profileFor(local),r.sim.map,{profiles:r.sim.profiles,actors:r.sim.state.actors});
    return {stored,restoredHp:local.hp,sickness:local.sourceTimeSickness,epochUnchanged:true};
  });
}
const filter=process.env.ADD_AUDIT_PROFESSION,onlySkill=Number(process.env.ADD_AUDIT_SKILL)||null;
for(const id of (process.argv.includes('--resources-only')?[]:['LP','MM','DE']).filter(id=>!filter||filter===id)){
  const profile=PROFESSION_PROFILES[id],samplers=samplersFor(id);
  for(const skill of profile.skillCatalog.filter(row=>row.topTier&&!row.passive&&row.supported&&row.skillId!==900&&(!onlySkill||row.skillId===onlySkill)))for(const formation of [false,true]){
    const row={profession:id,skillId:skill.skillId,formation,frames:0,maxBytes:0,maxEffects:0,states:[],summonFrames:0,summonStates:[],maxSummonEffects:0,maxAlwaysEffects:0,summonHits:0,projectileSamples:0,steeredProjectileSamples:0,unsupported:[]};report.rows.push(row);
    let stage='create';
    try{
      const from=addFixture(id,{skillId:skill.skillId,samplers,networkOwnerId:'add',passives:profile.defaultPassiveSkillIds}),to=addFixture(id,{skillId:skill.skillId,samplers,networkOwnerId:'target',passives:profile.defaultPassiveSkillIds});
      from.a.sourceAdd.dp=8000;from.a.sourceAdd.mutation=6;from.a.mp=from.a.mpMax;
      if(formation)startAddFormation(from.a,{profile});
      to.sim.state.nextEffectId=100000;
      const states=new Set(),summonStates=new Set();let started=0;
      for(let frame=1;frame<=720;frame++){
        row.frames=frame;stage='owner-step';
        from.sim.step(dt,{add:{pressed:frame===1?['A']:[],held:frame<=60?['A']:[]}},{snapshot:false});
        states.add(from.a.state);
        if(from.a.sourceAddSummon){row.summonFrames++;summonStates.add(from.a.sourceAddSummon.state);}
        row.maxSummonEffects=Math.max(row.maxSummonEffects,from.sim.state.effects.filter(e=>e.ownerId==='add'&&e.sourceAddSummonSerial!==undefined&&!e.dead).length);
        if(from.a.sourceAddSummon){
          const always=from.sim.state.effects.filter(e=>e.ownerId==='add'&&e.setName==='EffectSet_SI_HA_AMM_Apocalypse_Always'&&!e.dead);
          row.maxAlwaysEffects=Math.max(row.maxAlwaysEffects,always.length);
          assert.equal(always.length,38,'all original Always handles persist for independent NPC bones and explicit cleanup');
        }
        for(const e of from.sim.state.effects)if(e.ownerId==='add'&&e.sourceAddProjectile){row.projectileSamples++;if(e.sourceAddProjectile.hasManual)row.steeredProjectileSamples++;}
        for(const e of from.sim.drainEvents()){
          if(e.type==='skillStarted')started++;
          if(e.type==='hit'&&e.origin?.sourceAddSummonSerial!==undefined)row.summonHits++;
        }
        if(frame===300&&from.a.sourceAddSummon){
          // Explicit late/missing-presentation injection: remembered effect
          // IDs remain, while all live controls must be reconstructed anew.
          to.sim.state.effects=[];row.lateEffectRestoreFrame=frame;
        }
        stage='wire';const measured=transfer(from.sim,to.sim,frame,{critical:frame%30===0});
        row.maxBytes=Math.max(row.maxBytes,measured.bytes);row.maxEffects=Math.max(row.maxEffects,measured.effects);
        stage='receiver-step';to.sim.step(dt,{}, {snapshot:false});to.sim.drainEvents();
        if(frame%120===0){stage='restore';const snapshot=JSON.parse(JSON.stringify(to.sim.snapshot()));to.sim.restore(snapshot);assert.deepEqual(to.sim.snapshot(),snapshot);}
      }
      assert.equal(started,1,'exactly one accepted cast');row.states=[...states];
      row.summonStates=[...summonStates];
      if([29601,29604].includes(skill.skillId)){
        assert.ok(row.summonFrames>600,'independent NPC must persist and keep ticking after HA cast ends');
        assert.ok(summonStates.has('APOCALYPSE_START')&&summonStates.has('APOCALYPSE_WAIT')&&summonStates.size>=3,'original NPC states, not just owner animation');
        assert.ok(row.projectileSamples>0&&row.steeredProjectileSamples>0,'original A/B projectiles must select and steer during continued NPC AI');
        assert.ok(row.maxSummonEffects>0,'original NPC effects must be emitted');
      }
      row.dp=from.a.sourceAdd.dp;row.mutation=from.a.sourceAdd.mutation;
      row.unsupported=[...from.sim.state.unsupported,...from.a.unsupported].filter(x=>!['fidelity-unverified','native-effect-adapter-missing','native-defender-adapter-missing'].includes(x.id));
    }catch(error){row.error={stage,message:error.message,stack:error.stack};report.failures++;}
    console.log(id,skill.skillId,formation?'formation':'normal',row.error?`FAIL ${stage} ${row.error.message}`:`ok ${row.maxBytes} bytes / ${row.maxEffects} effects`);
  }
}
if(!filter&&!onlySkill)resourceQa();
// Declaration inventory only. Cast-time spending, delayed spending and recast
// spending have different owners; a stale list of numeric cast consumers must
// not label every other payload unsupported or complete.
report.mutationPayloadAudit=Object.entries(PROFESSION_PROFILES).filter(([id])=>['LP','MM','DE'].includes(id)).flatMap(([id,profile])=>
  profile.skillCatalog.filter(skill=>skill.topTier&&!skill.passive&&/Use [^\n]*Dynamo Mutation Point/i.test(skill.raw?.m_wstrMainDesc??''))
    .map(skill=>({profession:id,skillId:skill.skillId,baseSkillId:skill.raw.m_DeleteSkillIDByUpgrade??skill.skillId,
      status:'source declaration inventory; this filtered runtime report does not establish mutation payload completeness',
      declaredEnhancementFields:Object.keys(skill.raw).filter(key=>/MUTATION|ADD_DP_|SIZE|STUN_TIME/.test(key))})));
report.unavailableSkills=Object.entries(PROFESSION_PROFILES).filter(([id])=>['LP','MM','DE'].includes(id)).flatMap(([id,profile])=>
  profile.skillCatalog.filter(skill=>skill.topTier&&!skill.passive&&!skill.supported).map(skill=>
    ({profession:id,skillId:skill.skillId,name:skill.name,limitations:skill.limitations??[],status:skill.supportStatus})));
const suffix=process.env.ADD_AUDIT_SUFFIX??'';if(suffix&&!/^[a-z0-9-]+$/.test(suffix))throw new TypeError('Invalid report suffix');
const output=path.join(ownRoot,'reports/add-owned-runtime-observation'+(suffix?'-'+suffix:'')+'-v1.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,casts:report.rows.length,failures:report.failures}));if(report.failures)process.exitCode=1;
