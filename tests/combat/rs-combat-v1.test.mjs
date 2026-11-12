import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {runeSlayerCommands} from '../../packages/combat-core/rs-commands.mjs';
import {runeSlayerInstanceDefinition,runeSlayerAcceptedHit,runeSlayerEffectDamage} from '../../packages/combat-core/rs-skills.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),assets=resolve(root,'artifacts/rs');
const read=p=>JSON.parse(readFileSync(resolve(root,p)));
const profile=read('packages/combat-core/rs-profile.json'),preset=read('config/rs-preset.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const fx=read('artifacts/rs/fx/index.json'),index=mergeEffectIndexes(read('artifacts/rs/effect-assets.json'),fx);
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,JSON.parse(readFileSync(resolve(assets,p)))]));
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(resolve(root,'artifacts/native',p))});
const samplers=createNativeSamplers({profile,characterPose:read('artifacts/rs/runtime-pose.json'),effectIndex:index,effectPoses:poses});
function make(skillId=21026,branchId='none',facing=-1){
  return createSimulation({profile,map,preset:{...preset,loadout:[{skillId,branchId},null,null,null,null,null,null,null]},seed:2016,
    actors:[{id:'rs',professionId:'RS',team:0,position:[2022.98,2840,0],lineId:6,facing},
      {id:'target',professionId:'RS',team:1,position:[2022.98+164.87*facing,2840,0],lineId:6,facing:-facing,passives:[],guildPassives:[],loadout:Array(8).fill(null)}],
    ...samplers,nativeGeometry:native.geometry,nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeManaBreak:native.manaBreak});
}
const steps=(sim,count,input={})=>{for(let i=0;i<count;i++)sim.step(1/60,{rs:typeof input==='function'?input(i):input},{snapshot:false});};
const active=[21026,21217,21027,21028,21029,21220,21032,21030,21218,21035,21208,21209,21014,21015,21210,21016,21017,21211,21018,21604];
const observations=[];
after(()=>writeFileSync(resolve(root,'reports/rs-skill-validation-v3.json'),JSON.stringify({schemaVersion:3,evidenceClass:'current-simulator-real-source-geometry',originalClientMeasurements:0,
  scenario:'Production RS equipment/passives, original Garpai Rock line6, original character/effect helpers, native WASM collision,60Hz; independent source gates in contracts/rs-combat-source-v1.json',
  limitations:profile.unsupported,cases:observations},null,2)+'\n'));
test('RS 37-node tree has the independent 20 highest actives and five ST_PASSIVE nodes',()=>{
  assert.equal(profile.skillCatalog.length,37);
  assert.deepEqual(profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900).map(s=>s.skillId),active);
  assert.deepEqual(profile.defaultPassiveSkillIds,[21405,21407,21406,21408,21409]);
  assert.equal(profile.skillCatalog.find(s=>s.skillId===21407).raw.m_eType,8);
  assert.equal(profile.states.RSI_COMBO_ZZZ.sourceState,'ESSI_ERS_COMBO_ZZZ');
  assert.equal(profile.states.RSI_COMBO_XXX.sourceState,'ESSI_COMBO_X3');
});
for(const id of active)for(const branchId of ['none',...profile.skillCatalog.find(s=>s.skillId===id).branches.map(b=>b.id)])for(const awakened of [false,true])test(`RS skill ${id}/${branchId} ${awakened?'awakening':'normal'} legal cast and source end`,()=>{
  const sim=make(id,branchId),a=sim.actor('rs'),b=sim.actor('target'),skill=profile.skillCatalog.find(s=>s.skillId===id);a.mp=a.mpMax;b.mp=b.mpMax;
  if(awakened){a.awakening.remaining=30;a.awakening.full=true;}
  sim.step(1/60,{rs:{held:['A'],pressed:['A']}},{snapshot:false});
  const cast=sim.state.events.find(e=>e.type==='skillStarted'&&e.skillId===id);assert.ok(cast);
  const branch=skill.branches.find(b=>b.id===branchId),params=branch?.parameters??[],trait=branch?.memoTypeName;
  const expectedCost=skill.mpCost*(['MI_LIGHT','MI_BRILLIANT','MI_CRITICAL'].includes(trait)?params[0]:1);
  const expectedCooldown=skill.cooldown*(trait==='MI_FASTEST'?params[0]:['MI_HEAVY','MI_BRILLIANT'].includes(trait)?params[1]:1);
  assert.equal(cast.mpCost,expectedCost,'target MP cost/trait');assert.equal(cast.cooldown,expectedCooldown,'target cooldown/trait');
  if(id===21211){
    steps(sim,36,{held:['A']});assert.equal(a.state,'ESSI_ERS_COUNTER_GUARD');
    const hp=a.hp;sim.createEffect(b,{NAME:'FIREBALL_SMALL_DOWN_ELSWORD'},{birthAnchor:{position:[a.x+a.facing*30,a.y+100,a.z],facing:-a.facing,rotation:[0,a.facing>0?180:0,0],customPosition:true}});
    sim.tickEffects(0);assert.equal(a.hp,hp);assert.ok(sim.state.events.some(e=>e.type==='projectileReflected'&&e.actorId==='rs'),'guard reflects actual original helper contact');
  }
  steps(sim,720);assert.ok(['RSI_WAIT','ESSI_SWORD_WAIT'].includes(a.state));assert.ok(Number.isFinite(a.mp));
  assert.ok(!a.skillDisableGravity);assert.ok(a.hp>0);
  const hits=sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='rs'),buffs=sim.state.events.filter(e=>e.type==='buffApplied'&&e.actorId==='rs'),mpChanges=sim.state.events.filter(e=>['buffMpChanged','projectileAbsorbed','traitMpBurn','traitMpRefund'].includes(e.type));
  if(![21218,21211].includes(id))assert.ok(hits.some(e=>e.amount>0),'offensive skill must actually damage original defender helpers');
  const requiredBuff={21218:18,21209:49,21015:4,21016:3}[id];
  if(requiredBuff)assert.ok(buffs.some(e=>e.targetId==='rs'&&e.templateId===requiredBuff),'original skill self-buff applied');
  if(id===21017)assert.ok(mpChanges.some(e=>e.templateId===98&&Math.abs(e.delta+Math.fround(b.mpMax*Math.fround(.3)))<.001),'Luna burns30% maximum MP');
  if(id===21604){const burns=mpChanges.filter(e=>e.templateId===97);assert.equal(burns.length,6);assert.ok(burns.every(e=>e.delta===-10),'six rune sword burns of10 MP');}
  if(id===21220)assert.ok(hits.some(e=>sim.state.events.some(b=>b.type==='effectStarted'&&b.name==='DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST'&&e.origin.id===b.effectId)),'explosion itself hits');
  observations.push({skillId:id,name:skill.name??skill.raw.m_wstrName,branchId,trait,awakened,ended:a.state,mpCost:cast.mpCost,cooldown:cast.cooldown,hits:hits.length,
    damage:hits.reduce((sum,e)=>sum+e.amount,0),damageByOrigin:hits.map(e=>({amount:e.amount,kind:e.origin.kind,effectId:e.origin.id})),
    appliedBuffs:buffs.map(e=>({templateId:e.templateId,targetId:e.targetId,time:e.time})),resourceBenefits:mpChanges,
    reflectionEvents:sim.state.events.filter(e=>e.type==='projectileReflected'),
    createdEffects:[...new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.actorId==='rs').map(e=>e.name))],
    sourceLimitations:branch?.limitations??[],unsupported:a.unsupported.map(e=>({id:e.id,reason:e.reason}))});
});
for(const facing of [-1,1])test(`RS XZ rune real geometry hits only with paid MP, facing ${facing}`,()=>{
  const sim=make(21026,'none',facing),a=sim.actor('rs'),b=sim.actor('target');
  a.mp=100;const hp=b.hp;
  sim.step(1/60,{rs:{held:['X'],pressed:['X']}},{snapshot:false});
  steps(sim,8);sim.step(1/60,{rs:{held:['Z'],pressed:['Z']}},{snapshot:false});steps(sim,50);
  assert.ok(sim.state.events.some(e=>e.type==='rsCommandMp'&&e.amount===4),'source rune MP callback');
  const born=sim.state.events.find(e=>e.type==='effectStarted'&&e.name==='ELSWORD_RUNE_SLAYER_COMBO_XZ');assert.ok(born);
  assert.equal(born.definition.SCALE_X,Math.fround(1.4),'display birth and native collision use the same rune specialization size');
  assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.origin.kind==='effect'&&e.origin.id===born.effectId),'rune itself hits through original helpers');
  assert.ok(b.hp<hp,'original helper collision reduces HP');
  sim.enter(a,'ESSI_ERS_DASH_COMBO_XZ','test-fresh-insufficient');a.mp=0;steps(sim,30);
  assert.equal(a.sourceRuneSlayer.groundRuneCreated,false);
  const before=sim.state.nextEffectId;sim.enter(a,'ESSI_ERS_XZZ','test-failed-prerequisite');steps(sim,12);
  assert.equal(sim.state.effects.filter(e=>e.id>=before&&e.name==='ELSWORD_RUNE_SLAYER_COMBO_XZZ').length,0);
});
test('RS rune source scale is reconstructed from a validated passive level on ownership restore',()=>{
  const sim=make(),a=sim.actor('rs');a.mp=100;sim.enter(a,'ESSI_ERS_XZ','test-rune');steps(sim,20);
  const e=sim.state.effects.find(e=>e.name==='ELSWORD_RUNE_SLAYER_COMBO_XZ');assert.ok(e);
  assert.equal(e.sourceRuneLevel,3);assert.equal(e.definition.SCALE_X,Math.fround(1.4));
  const report=encodeOwnedState(sim,'rs',{frameSeq:20,epoch:0});validateOwnedState(report);
  const restored=make();applyOwnedState(restored,'rs',report);const remote=restored.state.effects.find(e=>e.name===e?.name&&e.name==='ELSWORD_RUNE_SLAYER_COMBO_XZ');
  assert.ok(remote);assert.deepEqual(remote.definition,e.definition);assert.equal(remote.lifeTimeSeconds,e.lifeTimeSeconds);
  assert.equal(runeSlayerInstanceDefinition(profile,{...e,sourceRuneLevel:4},{NAME:e.name}),null);
  assert.equal(runeSlayerCommands.handlesEvent({state:'RSI_WAIT'}),false);
  assert.equal(runeSlayerCommands.handlesEvent({state:'ESSI_ERS_XZ'}),true);
});
test('RS rune multipliers and input windows match independently saved source rows',()=>{
  const source=read('contracts/rs-combat-source-v1.json'),e=source.independentRuneExpectations;
  for(const [name,row]of Object.entries(source.damage))assert.deepEqual(profile.damageEffects[name]?.raw.DAMAGE_DATA,row.raw);
  assert.equal(profile.damageEffects.ELSWORD_RUNE_SLAYER_COMBO_XZ.raw.DAMAGE_DATA.DAMAGE.MAGIC,e.xzMagic);
  assert.equal(profile.damageEffects.ELSWORD_RUNE_SLAYER_COMBO_FULL_CHARGE_XZZ.raw.DAMAGE_DATA.HIT_GAP,e.fullChargeHitGap);
  assert.equal(profile.states.ESSI_ERS_XZ_CHARGE.raw.EVENT_PROCESS_TIME0['1'],1);
});
test('RS Phoenix absorption and fire sword hit factors are supported original buff consumers',()=>{
  const sim=make(),a=sim.actor('rs'),b=sim.actor('target');a.mp=0;
  const phoenix=sim.grantBuff(a,a,46,1,null);assert.ok(phoenix);
  assert.ok(phoenix.behaviors.some(row=>row.kind==='absorbMagicProjectile'&&row.mp===10));
  const hp=a.hp,mp=a.mp,result=sim.applyHit(b,a,{CAN_REFLEX:1,DAMAGE:{MAGIC:2},DAMAGE_TYPE:1,REACT_TYPE:2,ATTACK_TYPE:2},{kind:'effect',id:123});
  assert.equal(result.absorbed,true);assert.equal(a.hp,hp);assert.equal(a.mp,mp+10);
  const fire=sim.grantBuff(a,a,44,1,null);assert.ok(fire);assert.ok(fire.behaviors.some(row=>row.kind==='onHitBuffFactor'&&row.factorId===2));
  for(const factor of [162,163,164])assert.ok(sim.grantBuff(a,a,factor,3,null));
  assert.equal(a.buffs.filter(buff=>[163,164,165].includes(buff.templateId)).length,1,'three enchants exclude each other');
  const report=encodeOwnedState(sim,'rs',{epoch:0,frameSeq:1});assert.doesNotThrow(()=>validateOwnedState(report));
});
for(const full of [false,true])test(`RS target rune ${full?'full charge':'release'} creates its own damage row and naturally ends`,()=>{
  const sim=make(),a=sim.actor('rs');a.mp=100;sim.enter(a,'ESSI_ERS_XZ','test-charge-entry');
  steps(sim,36,i=>({held:['Z'],pressed:i===6?['Z']:[]}));
  assert.ok(['ESSI_ERS_XZ_CHARGE','ESSI_ERS_XZZ'].includes(a.state));
  steps(sim,180,full?{held:['Z']}:{});
  const effect=full?'ELSWORD_RUNE_SLAYER_COMBO_FULL_CHARGE_XZZ':'ELSWORD_RUNE_SLAYER_COMBO_XZZ';
  assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.name===effect));
  assert.equal(a.state,'RSI_WAIT');assert.ok(!sim.state.effects.some(e=>e.name===effect&&!e.dead));
});
test('RS airborne rune continuation releases gravity and lands without manual state resets',()=>{
  const sim=make(),a=sim.actor('rs');a.mp=100;a.y+=400;a.grounded=false;a.lineId=null;
  sim.enter(a,'ESSI_ERS_DASH_JUMP_XZ','test-air-start');
  steps(sim,180,i=>({held:i<30?['Z']:[],pressed:i===5?['Z']:[]}));
  assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ'));
  assert.ok(sim.state.events.some(e=>e.type==='effectStarted'&&e.name==='ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ'));
  assert.equal(a.skillDisableGravity,false);assert.equal(a.grounded,true);assert.equal(a.state,'RSI_WAIT');
});

for(const id of [21017,21604])test(`RS ${id} moving mesh/bone-target owner roundtrip preserves original collision geometry`,()=>{
  const sim=make(id),a=sim.actor('rs');a.mp=a.mpMax;
  sim.step(1/60,{rs:{held:['A'],pressed:['A']}},{snapshot:false});
  for(let frame=0;frame<62;frame++){steps(sim,1);assert.doesNotThrow(()=>encodeOwnedState(sim,'rs',{frameSeq:frame+1,epoch:0}));}
  const live=sim.state.effects.filter(e=>e.ownerId==='rs'&&e.active&&e.damage?.DAMAGE_DATA);assert.ok(live.length);
  const report=encodeOwnedState(sim,'rs',{frameSeq:63,epoch:0});validateOwnedState(report);
  const peer=make(id);applyOwnedState(peer,'rs',report);
  for(const e of live){
    const restored=peer.state.effects.find(r=>r.networkId===e.id);assert.ok(restored,e.name);
    const {evidence,...geometry}=e.currentAnchor;
    assert.equal(typeof evidence,'string','local source anchor retains its provenance');
    assert.deepEqual(restored.currentAnchor,geometry);
    assert.equal(Object.hasOwn(restored.currentAnchor,'evidence'),false);
    assert.deepEqual(peer.effectSampler(restored,peer.actor('rs'),{profile}),sim.effectSampler(e,a,{profile}));
    if(id===21017){
      const {evidenceClass,...mesh}=JSON.parse(JSON.stringify(e.sourceShadowMesh));
      assert.equal(typeof evidenceClass,'string');assert.deepEqual(restored.sourceShadowMesh,mesh);
      assert.equal(Object.hasOwn(restored.sourceShadowMesh,'evidenceClass'),false);
    }
  }
});

test('RS original immediate MP factors retain separate zero-accumulation identities and one frame lifetime',()=>{
  const sim=make(),a=sim.actor('rs'),b=sim.actor('target');b.mp=300;
  const raw=profile.damageEffects.DAMAGE_EFFECT_ERS_Luna_Buster_Loophit.raw.DAMAGE_DATA.BUFF_FACTOR;
  assert.ok(sim.grantBuff(a,b,raw));assert.ok(sim.grantBuff(a,b,raw));
  assert.equal(b.buffs.filter(v=>v.templateId===97).length,2);
  assert.doesNotThrow(()=>validateOwnedState(encodeOwnedState(sim,'target',{epoch:0,frameSeq:1})));
  sim.advanceActorBuffs(b,1/60);assert.equal(b.mp,280);assert.ok(!b.buffs.some(v=>v.templateId===97));
  sim.advanceActorBuffs(b,1/60);assert.equal(b.mp,280);
});

test('RS Magic Chain excludes special/hyper and original enhanced burst frequency selects the target row',()=>{
  const sim=make(21604),a=sim.actor('rs'),b=sim.actor('target');sim.rng=()=>0;
  runeSlayerAcceptedHit(sim,a,b,{ATTACK_TYPE:1},{kind:'effect',skillId:21604});assert.ok(!b.buffs.some(v=>v.templateId===81));
  runeSlayerAcceptedHit(sim,a,b,{ATTACK_TYPE:2},{kind:'character',skillId:null});assert.ok(b.buffs.some(v=>v.templateId===81));
  const damage=profile.damageEffects.DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST.raw;
  assert.equal(runeSlayerEffectDamage(profile,{skillId:21220,stage:0,damage},damage.DAMAGE_DATA).HIT_GAP,.05);
  assert.equal(runeSlayerEffectDamage(profile,{skillId:21207,stage:0,damage},damage.DAMAGE_DATA).HIT_GAP,.07);
  assert.deepEqual(profile.effectTemplates.ELSWORD_MNK_BIG_BURST_ATTACK_BOX.initialVelocity,[0,0,0]);
  assert.equal(profile.effectTemplates.ELSWORD_MNK_BIG_BURST_ATTACK_BOX.fields.LifeTime,.5);
});
