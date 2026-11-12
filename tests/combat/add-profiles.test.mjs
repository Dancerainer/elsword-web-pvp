import {tickAddFactory,addFactoryModeBuff} from '../../packages/combat-core/add-factory.mjs';
import {addDynamoEvents,applyAddDynamoDuration,ADD_DYNAMO_RESOURCE_ROOTS} from '../../packages/combat-core/add-dynamo-skills.mjs';
import {addRecastResourcePlan,addRecastEvents,addRecastStateStart,tickAddRecasts,addStasisDamageObserved} from '../../packages/combat-core/add-recasts.mjs';
import {startAddFury,tickAddFury} from '../../packages/combat-core/add-fury.mjs';
import {validateAddFuryEffectState,addLinkedDefinition} from '../../packages/combat-core/add-linked-effect-state.mjs';
import {addFrontalTargets,addTargetSkillEvents} from '../../packages/combat-core/add-target-skills.mjs';
import {addFixedDistancePosition} from '../../packages/combat-core/add-nasod-geometry.mjs';
import {addSkillAnimationMultiplier} from '../../packages/combat-core/add-skills.mjs';
import {addDamageModifiers,addAcceptedHit,addNasodRequest,addStateStart} from '../../packages/combat-core/add-nasod.mjs';
import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {addCommands,addBufferedWindow,addCommandSkillCancelAllowed} from '../../packages/combat-core/add-commands.mjs';
import {ADD_DYNAMIC_SKILL_EVENTS,addEvents,addCastState,addSkillEvent,addSkillCancelAllowed} from '../../packages/combat-core/add-skills.mjs';
import {initializeAddPassives,tickAddPassiveBuffs,applyAddMindControlRefund} from '../../packages/combat-core/add-passives.mjs';
import {calculateSourceEquipmentCandidate,sourceItemBase} from '../../packages/combat-core/source-equipment-base.mjs';
const read=n=>JSON.parse(fs.readFileSync(new URL('../../'+n,import.meta.url)));
const profiles=Object.fromEntries(['lp','mm','de'].map(id=>[id,read('packages/combat-core/'+id+'-profile.json')]));
const actor=(id,state,values={})=>({id:'a',professionId:id.toUpperCase(),state,grounded:true,animationTime:0,animationBeforeTime:0,animationOneshotTimer:0,stateTime:0,vx:0,vy:0,x:0,y:0,z:0,facing:1,passiveSpeed:{x:-1,y:-1},sourceCommandFlags:0,awakening:{remaining:0},sourceAdd:{dp:100,formation:false},fired:[],...values});
const keys=(pressed=[],held=pressed)=>({pressed:new Set(pressed),held:new Set(held),pureDoubleLeft:false,pureDoubleRight:false});
const nativeValues={abilityValue:(v,l)=>v[l],increasingRate:v=>v-1};
test('Output Exchange follows the source half-DP boundary once and carries original mutually exclusive buffs',()=>{
 const p=profiles.lp,a=actor('lp','RSI_WAIT',{sourceAdd:{dp:3999},passivePolicy:initializeAddPassives(p,{nativeValues})}),calls=[];
 const sim={grantBuff:(...args)=>calls.push(args.slice(2))};
 tickAddPassiveBuffs(sim,a);tickAddPassiveBuffs(sim,a);assert.deepEqual(calls,[[357,3,null]]);
 a.sourceAdd.dp=4000;tickAddPassiveBuffs(sim,a);a.sourceAdd.dp=8000;tickAddPassiveBuffs(sim,a);assert.deepEqual(calls[1],[356,3,null]);assert.equal(calls.length,2);
 a.sourceAdd.dp=3999;tickAddPassiveBuffs(sim,a);assert.equal(calls[2][0],357);
 const up=p.buffFactors[356].raw,down=p.buffFactors[357].raw;
 assert.equal(up.BEHAVIOR.BBT_CHANGE_MAGIC_ATTACK.PERCENT[3],1.06);assert.equal(up.BEHAVIOR.BBT_CHANGE_CRITICAL_RATE.FIX_VALUE[3],6);
 assert.equal(down.BEHAVIOR.BBT_CHANGE_HYPER_CHARGE_SPEED.PERCENT[3],1.4);
 assert.equal(p.buffTemplates[334].raw.BEHAVIOR.BBT_FINISH_OTHER_BUFF_DEBUFF[1],335);
 assert.equal(p.buffTemplates[335].raw.BEHAVIOR.BBT_FINISH_OTHER_BUFF_DEBUFF[1],334);
 tickAddPassiveBuffs(sim,actor('mm','RSI_WAIT',{passivePolicy:a.passivePolicy}));assert.equal(calls.length,3);
});
test('New Update grants only its own original MP-gain factor at the learned level',()=>{
 const p=profiles.mm,a=actor('mm','RSI_WAIT',{passivePolicy:initializeAddPassives(p,{nativeValues})}),calls=[];
 const sim={profileFor:()=>p,grantBuff:(...args)=>calls.push(args.slice(2))};
 addFactoryModeBuff(sim,a);assert.deepEqual(calls,[[367,3,null]]);
 const raw=p.buffFactors[367].raw,template=p.buffTemplates[343].raw;
 assert.equal(raw.BUFF_TEMPLET_ID,343);assert.equal(template.ACCUMULATION_LIMIT,3);assert.equal(template.ACCUMULATION_MULTIPLIER,1);
 assert.equal(raw.FINALIZER.BFT_TIME.NORMAL_TIME[3],15);
 for(const name of ['BBT_CHARGE_MP_HIT_MELEE_ATTACK','BBT_CHARGE_MP_HIT_RANGE_ATTACK','BBT_CHARGE_MP_HITTED'])assert.equal(raw.BEHAVIOR[name].PERCENT[3],1.1);
 addFactoryModeBuff(sim,{...a,passivePolicy:{skillLevels:{29409:3}}});assert.equal(calls.length,1);
});
for(const [id,cl,passives]of [['lp',122,[29400,29401,29402,29403,29404]],['mm',123,[29405,29406,29407,29408,29409]],['de',126,[29410,29411,29412,29413,29414]]]){
 const p=profiles[id],preset=read('config/'+id+'-preset.json');
 test(id+' owns target career, all skill roots, source hashes and its five passive nodes',()=>{
  assert.equal(p.target.unitType,9);assert.equal(p.target.unitClass,cl);assert.equal(p.skillCatalog.length,37);assert.deepEqual([...p.defaultPassiveSkillIds].sort(),passives);
  assert.equal(p.sources.add.sha256,'47476953d8ab9fd70f518938cf1306ef719ccf58c51313d3342747c3074a243d');
  for(const s of p.skillCatalog.filter(s=>!s.passive)){assert.ok(p.states[s.state],s.skillId);assert.equal(s.fidelityVerified,false);}
  for(const [name,s]of Object.entries(p.states)){assert.ok(s.clip.durationSeconds>0,name);assert.equal(s.raw.ANIM_NAME,s.animationName,name);}
  assert.equal(p.validation.clientMeasured,false);
 });
 test(id+' receives requested equipment options and true Add Dynamo base once',()=>{
  const prior=read('config/'+(id==='lp'?'rf':'vc')+'-preset.json');
  const ownFields=new Set(['hpMax','physicalAttack','magicAttack','physicalDefence','magicDefence','awakeningChargeBonus','awakeningDurationBonus','addDpGainBonus','addDpConsumptionReduction']);
  for(const key of Object.keys(preset.attributes).filter(key=>!ownFields.has(key)))assert.equal(preset.attributes[key],prior.attributes[key],key);
  assert.equal(preset.attributes.addDpGainBonus,.5);assert.equal(preset.attributes.addDpConsumptionReduction,.5);assert.equal(preset.attributes.awakeningChargeBonus,0);assert.equal(preset.attributes.awakeningDurationBonus,0);
  const result=calculateSourceEquipmentCandidate({profession:id.toUpperCase(),...preset.sourceEquipment});assert.equal(result.items[0].itemId,30412);for(const [key,v]of Object.entries(result.pvp))assert.equal(preset.attributes[key],v);
  assert.throws(()=>sourceItemBase(id.toUpperCase(),30397),/mismatch/);assert.equal(preset.ravenCoreEnabled,false);
 });
 test(id+' has independent passive policy and rejects another career grants',()=>{
  const policy=initializeAddPassives(p,{nativeValues});assert.deepEqual(Object.keys(policy.skillLevels).map(Number).sort(),passives);assert.equal(policy.burning.enabled,false);assert.equal(policy.awakening.enabled,false);
  assert.throws(()=>initializeAddPassives(p,{nativeValues,passiveIds:[24400]}),/Invalid Add/);
  if(id==='mm')assert.equal(policy.stats.mpMaxAdd,30);if(id==='de')assert.equal(policy.speedPassives.animationSpeedMultiplier.multiple,1.04);
 });
 for(const [name,def]of Object.entries(p.states).filter(([n,v])=>n===v.sourceState&&Number.isFinite(v.raw.SKILL_CANCEL_AFTER)&&v.raw.SKILL_CANCEL_AFTER>=0&&v.raw.SKILL_CANCEL_AFTER<99999&&(/COMBO|JUMP_ATTACK/.test(n)||/^ANSI_(A_|SA_|HA_)/.test(n)))){
  test(id+' strict target skill cancel '+name,()=>{
   const fn=/COMBO|JUMP_ATTACK/.test(name)?addCommandSkillCancelAllowed:addSkillCancelAllowed;
   const airborne=(name.includes('DASH_JUMP')||name.includes('JUMP_ATTACK')||name==='ANSI_ALP_COMBO_ZZXX')&&!name.endsWith('_LANDING');
   const t=def.raw.SKILL_CANCEL_AFTER_FLY??def.raw.SKILL_CANCEL_AFTER;
   for(const [delta,expected]of [[-.00001,false],[0,false],[.00001,true]])assert.equal(fn(actor(id,name,{animationTime:t+delta,grounded:!airborne}),def),expected);
  });
 }
 test(id+' dynamic original callbacks keep every target damage/set root',()=>{
  for(const [state,rows]of Object.entries(ADD_DYNAMIC_SKILL_EVENTS))if(p.states[state])for(const [,kind,name]of rows)assert.ok((kind==='set'?p.effectSets:p.damageEffects)[name],state+'/'+name);
 });
 test(id+' command followup is buffered and preserves the exact target upper boundary',()=>{
  const a=actor(id,'RSI_COMBO_Z',{animationTime:.1});let r=addCommands.runEvent(a,keys(['Z']),p);assert.equal(r.state,null);assert.equal(r.flags,1);
  r=addCommands.runEvent({...a,sourceCommandFlags:r.flags,animationTime:.22},keys(),p);assert.equal(r.state,null);
  r=addCommands.runEvent({...a,sourceCommandFlags:1,animationTime:.221},keys(),p);assert.equal(r.state,'RSI_COMBO_ZZ');
  r=addCommands.runEvent({...a,animationTime:.27},keys(['Z']),p);assert.equal(r.flags,0);
 });
 test(id+' target new ZZX promotion cannot select another class',()=>{
  const pfx={lp:'ALP',mm:'AMM',de:'ADE'}[id];const a=actor(id,'RSI_COMBO_ZZ',{animationTime:.2});const b=addCommands.runEvent(a,keys(['X']),p);const r=addCommands.runEvent({...a,animationTime:.46,sourceCommandFlags:b.flags},keys(),p);assert.equal(r.state,'ANSI_'+pfx+'_COMBO_ZZX');
 });
}
test('malformed event window remains unsupported',()=>assert.equal(addBufferedWindow(0,0,1,true,{'1':0,'2':'bad','3':.4}).unsupported,true));
test('dynamic callback is one-shot and target common visual declaration is not rewritten',()=>{
 const p=profiles.lp,a=actor('lp','ANSI_SA_AN_NEUTRON_BOMB'),calls=[];const sim={profileFor:()=>p,fire:(a,id,t,b,e,fn)=>{if(!a.fired.includes(id)&&b<t&&e>=t){a.fired.push(id);fn();}},spawnSet:(a,n)=>calls.push(n),note:()=>{},createEffect:()=>{}};
 addEvents(sim,a,1,1.1);addEvents(sim,a,1,1.2);assert.deepEqual(calls,['EffectSet_SI_SA_AN_Neutron_Bomb_Attack']);
});
test('stopped Pulse Cannon obeys four prepaid and eight maximum source shots',()=>{
 const p=profiles.lp,a=actor('lp','ANSI_SA_APT_PULSE_CANNON_LOOP',{animationStopped:true,mp:100,skillId:29034,skillContext:{key:'A'},sourceAddCombat:{pulseCount:0,pulseOrder:[1,2,3,4,5,6]}}),entered=[];const sim={profileFor:()=>p,skill:()=>p.skillCatalog.find(s=>s.skillId===29034),enter:(a,n)=>entered.push(n),note:()=>{}};
 for(let i=0;i<8;i++)addSkillEvent(sim,a,keys([],['A']));assert.equal(a.mp,0);assert.deepEqual(entered,Array(7).fill('ANSI_SA_APT_PULSE_CANNON_LOOP').concat('ANSI_SA_APT_PULSE_CANNON_FINISH'));
});
test('DE missing Stardust source animations remain declared unsupported without fake clip',()=>{
 const p=profiles.de;assert.ok(p.unsupportedStates.ANSI_SA_ATT_STARDUST_SHOWER_END);assert.equal(p.states.ANSI_SA_ATT_STARDUST_SHOWER_END,undefined);assert.equal(p.states.ANSI_SA_ATT_STARDUST_SHOWER.raw.ANIM_NAME,'SI_SA_ATT_STARDUST_SHOWER');
});

test('MM selects original create action and switches without a cast state while playing the original switch impact',()=>{
 const p=profiles.mm,a=actor('mm','RSI_WAIT'),effects=[];const sim={profileFor:()=>p,spawnSet:(a,n)=>effects.push(n),state:{effects:[]}};const skill=p.skillCatalog.find(s=>s.skillId===29016);
 assert.equal(addCastState(sim,a,skill,{mode:'generator-select'}),'ANSI_AAT_CREATE_DYNAMO_FACTORY');assert.ok(p.states.ANSI_AAT_CREATE_DYNAMO_FACTORY);
 assert.equal(addCastState(sim,a,skill,{mode:'generator-switch'}),null);assert.deepEqual(effects,['EffectSet_SI_SA_AAT_Installation_Drone_Change_3','EffectSet_A_APT_Pylon_Dynamo_Start','EffectSet_A_APT_Pylon_Dynamo_Impact']);
 assert.equal(addCastState(sim,a,skill,{mode:'generator-fire'}),skill.state);
});

for(const id of ['lp','mm','de']){
 test(id+' Nasod connection requires real target and strict buffered source window',()=>{
  const p=profiles[id],state='ANSI_SA_AN_VOID_BREAKER',w=p.states[state].raw.EVENT_PROCESS_TIME0;
  assert.ok(p.referenceSemantics.nasodArmorStates.includes(state));
  const a=actor(id,state,{animationTime:w['1'],sourceAdd:{formation:true}});
  assert.equal(addNasodRequest(a,p.states[state],p,keys(['Z'])),null);assert.equal(a.sourceAddCombat.nasodFlag,true);
  a.animationTime=w['3']+.00001;assert.equal(addNasodRequest(a,p.states[state],p,keys()),null);
  a.sourceAddCombat.nasodTargetId='enemy';a.animationTime=w['3'];assert.equal(addNasodRequest(a,p.states[state],p,keys()),null);
  a.animationTime+=.00001;assert.equal(addNasodRequest(a,p.states[state],p,keys()),'ANSI_COMBO_NASOD_ARMOR_READY');assert.equal(a.sourceAddCombat.nasodFlag,false);
 });
 test(id+' Nasod ready landing and class-specific Z route retain target input timing',()=>{
  const p=profiles[id],a=actor(id,'ANSI_COMBO_NASOD_ARMOR_READY',{animationStopped:true});
  assert.equal(addCommands.runEvent(a,keys(),p).state,'ANSI_COMBO_NASOD_ARMOR_ATTACK');
  a.state='ANSI_COMBO_NASOD_ARMOR_ATTACK';const landing=id==='de'?'ANSI_ATT_COMBO_NASOD_ARMOR_LANDING':'ANSI_COMBO_NASOD_ARMOR_LANDING';assert.equal(addCommands.runEvent(a,keys(),p).state,landing);
  a.state=landing;a.animationStopped=false;a.animationTime=.1;const buffered=addCommands.runEvent(a,keys(['Z']),p);a.sourceCommandFlags=buffered.flags;a.animationTime=.567;
  assert.equal(addCommands.runEvent(a,keys(),p).state,id==='lp'?'ANSI_COMBO_NASOD_ARMOR_Z':id==='mm'?'ANSI_AAT_COMBO_NASOD_ARMOR_Z':'ANSI_ATT_COMBO_NASOD_ARMOR_Z');
 });
}
test('Nasod accepted target preserves native range and height limits, resets on wait',()=>{
 const p=profiles.lp,a=actor('lp','ANSI_SA_AN_VOID_BREAKER',{team:0}),b={...actor('mm','RSI_WAIT'),id:'enemy',x:200,team:1,hp:100};
 const sim={profileFor:()=>p,effectAnchorSampler:(e,a)=>({position:[a.x,a.y+100,a.z]}),nativeGeometry:{nearest:({position})=>({found:true,point:[position[0],0,position[2]]})},note:()=>{}};
 assert.equal(addAcceptedHit(sim,a,b,{CAN_ACTIVATE_NASOD_ARMOR_COMBO:0}),false);assert.equal(addAcceptedHit(sim,a,b,{CAN_ACTIVATE_NASOD_ARMOR_COMBO:1}),true);assert.equal(a.sourceAddCombat.nasodTargetId,'enemy');
 b.y=501;assert.equal(addAcceptedHit(sim,a,b,{CAN_ACTIVATE_NASOD_ARMOR_COMBO:1}),false);b.y=0;b.x=1001;assert.equal(addAcceptedHit(sim,a,b,{CAN_ACTIVATE_NASOD_ARMOR_COMBO:1}),false);
 a.state='RSI_WAIT';addStateStart(sim,a);assert.equal(a.sourceAddCombat.nasodTargetId,null);
});
test('Nasod passive damage excludes ordinary commands but down passive includes both',()=>{
 const a=actor('lp','RSI_WAIT',{passivePolicy:{add:{nasodArmorDamageMultiplier:2,forceDownMultiplier:.8}}});
 assert.deepEqual(addDamageModifiers(a,{DYNAMO_PARTICLE_RATE_TYPE:3}),{damageMultiplier:2,forceDownMultiplier:.8});assert.equal(addDamageModifiers(a,{DYNAMO_PARTICLE_RATE_TYPE:2}).damageMultiplier,1);
});

test('Nasod pursuit traverses original connected XYZ segments and edge margin',()=>{
 const map={lines:[{lineId:0,start:[0,0,0],end:[100,0,0],beforeLine:-1,nextLine:1},{lineId:1,start:[100,0,0],end:[100,0,200],beforeLine:0,nextLine:-1}]};
 const g={land:()=>({found:true,lineId:0}),distance:(a,b)=>Math.fround(Math.hypot(...a.map((n,i)=>n-b[i])))};
 const q=addFixedDistancePosition(g,map,{position:[50,0,0],distance:120,right:true});assert.equal(q.found,true);assert.equal(q.lineId,1);assert.ok(Math.abs(q.point[2]-70)<.00002);assert.equal(q.point[0],100);
 assert.equal(addFixedDistancePosition(g,map,{position:[50,0,0],distance:36,right:false}).found,false);
 const boundary=addFixedDistancePosition(g,map,{position:[50,0,0],distance:35,right:false});assert.equal(boundary.found,true);assert.ok(Math.abs(boundary.point[0]-15)<.00001);
 assert.throws(()=>addFixedDistancePosition(null,map,{position:[0,0,0],distance:100,right:true}),/Original land/);
});
test('Storm uses target mutation duration and size without a second damage multiplier',()=>{
 const p=profiles.lp,skill=p.skillCatalog.find(s=>s.skillId===29009),a=actor('lp',skill.state,{skillContext:{addMutationSpent:3},skillScale:1,sourceAdd:{formation:true}});
 const sim={profileFor:()=>p};addCastState(sim,a,skill,{mode:'cast'});assert.ok(Math.abs(a.sourceAddCombat.stormDuration-1.705)<1e-10);assert.ok(Math.abs(a.sourceAddCombat.stormSize-1.93)<1e-10);assert.equal(a.skillScale,1);
});
test('Final enhanced Pulse Cannon uses its own target cast-speed modifier',()=>{
 const p=profiles.lp,a=actor('lp','ANSI_SA_APT_PULSE_CANNON_LOOP',{skillId:29034});assert.equal(addSkillAnimationMultiplier(a,p),1.3);a.skillId=29006;assert.equal(addSkillAnimationMultiplier(a,p),1);a.state='RSI_WAIT';assert.equal(addSkillAnimationMultiplier(a,p),1);
});

test('MM factory selection creates only the chosen original follower and cleans it on clear',()=>{
 const a=actor('mm','RSI_WAIT',{hp:100,lineId:0,sourceAdd:{generator:{skillId:29016},formation:false}}),p=profiles.mm,state={effects:[],nextEffectId:1};
 const sim={state,map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},profileFor:()=>p,note:()=>{},emit:()=>{},createEffect:(a,d,o)=>{const e={id:state.nextEffectId++,ownerId:a.id,name:d.NAME,birthAnchor:o.birthAnchor};state.effects.push(e);return e;}};
 tickAddFactory(sim,a);assert.equal(state.effects[0].name,'DAMAGE_EFFECT_Star_Fall_Generate');assert.deepEqual(state.effects[0].currentAnchor.position,[-200,150,0]);
 a.x=100;tickAddFactory(sim,a);assert.deepEqual(state.effects[0].currentAnchor.position,[-190,150,0]);
 a.sourceAdd.generator=null;tickAddFactory(sim,a);assert.equal(state.effects[0].dead,true);assert.equal(state.effects.length,1);
});
test('Offense Mode never resamples a factory scalar during damage acceptance',()=>{
 const a=actor('mm','RSI_WAIT',{sourceAdd:{formation:true},passivePolicy:{add:{installationDamageMultiplier:1.15}}});
 for(const formation of [false,true])for(const skillId of [29013,29035,29016,29017,29018,29204]){
  a.sourceAdd.formation=formation;assert.equal(addDamageModifiers(a,{APPLIED_SKILL_ID:skillId}).damageMultiplier,1);
 }
 a.passivePolicy.add.nasodArmorDamageMultiplier=1.2;assert.equal(addDamageModifiers(a,{DYNAMO_PARTICLE_RATE_TYPE:3}).damageMultiplier,1.2);
});
test('static analysis Stardust actual main-exit path is available while original-client fidelity and carrier inputs stay qualified',()=>{
 const s=profiles.de.skillCatalog.find(s=>s.skillId===29021);assert.equal(s.supported,true);assert.equal(s.supportStatus,'partial-target2016-static-consumer');assert.deepEqual(s.states,['ANSI_SA_ATT_STARDUST_SHOWER']);assert.ok(s.limitations[0].key);
 for(const sid of [29016,29018]){const recovered=profiles.mm.skillCatalog.find(s=>s.skillId===sid);assert.equal(recovered.supported,true);assert.equal(recovered.supportStatus,'target2016-native-control+qualified-web-selection');assert.equal(recovered.fidelityVerified,false);assert.ok(recovered.limitations.some(row=>row.key.endsWith('-selection-fidelity')));}
 assert.equal(profiles.lp.skillCatalog.find(s=>s.skillId===29216).limitations.length,0);
});

test('DE scan excludes allies, behind, defeated and out-of-range actors with stable distance order',()=>{
 const a=actor('de','RSI_WAIT',{lineId:0,team:0}),en=(id,x,extra={})=>({id,x,y:0,z:0,team:1,hp:100,...extra});
 const sim={state:{actors:[a,en('behind',-1),en('ally',1,{team:0}),en('far',701),en('dead',1,{hp:0}),en('equal-first',300),en('equal-second',300),en('nearest',100)]},map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]}};
 assert.deepEqual(addFrontalTargets(sim,a,700,3).map(x=>x.id),['nearest','equal-first','equal-second']);
});

test('DE Mind Break uses target ESP cap and debuff at the qualified .271 event',()=>{
 const p=profiles.de,skill=p.skillCatalog.find(s=>s.skillId===29214),a=actor('de',skill.state,{skillId:29214,lineId:0,team:0,passivePolicy:{skillLevels:{29414:3}}}),hits=[],buffs=[];
 const actors=[a,...Array.from({length:5},(_,i)=>({id:'enemy'+i,x:100+i*20,y:0,z:0,team:1,hp:100}))];
 const sim={profileFor:()=>p,state:{actors},map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},grantBuff:(a,b,id,level)=>buffs.push([b.id,id,level]),effectAnchorSampler:(_,b)=>({position:[b.x,100,0]}),createEffect:(a,d)=>hits.push(d.NAME)};
 addTargetSkillEvents(sim,a,0,.270);assert.equal(hits.length,0);addTargetSkillEvents(sim,a,.270,.271);assert.equal(hits.length,4);assert.equal(buffs.length,4);assert.ok(buffs.every(b=>b[1]===347));
 assert.equal(p.skillCatalog.find(s=>s.skillId===29214).supported,true);
});

test('DE Force Finger uses target drain/recovery and recipient ownership',()=>{
 const p=profiles.de,skill=p.skillCatalog.find(s=>s.skillId===29215),a=actor('de',skill.state,{skillId:29215,lineId:0,team:0,mp:0,mpMax:330,sourceAdd:{formation:true,dp:100}}),b={id:'enemy',x:100,y:0,z:0,team:1,hp:100,mp:50},notes=[];
 a.loadout=[{skillId:29215}];
 const sim={networkOwnerId:'a',networkEpochFor:()=>0,profileFor:()=>p,state:{actors:[a,b]},map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},createEffect:()=>{},note:k=>notes.push(k),emit:()=>{}};
 addTargetSkillEvents(sim,a,0,.271);assert.equal(b.mp,50);assert.equal(a.sourceAdd.dp,1000);assert.deepEqual(notes,[]);assert.equal(a.sourceAddTargetNotice.targets[0].id,'enemy');
 sim.networkOwnerId=null;addTargetSkillEvents(sim,a,0,.271);assert.equal(b.mp,35);assert.equal(a.sourceAdd.dp,1900);
});

test('Ultimate Fury uses three original nodes, target range and absolute beam scale',()=>{
 const p=profiles.mm,a=actor('mm','ANSI_SA_AMM_INSTALLATION_ULTIMATE_FURY',{hp:100,team:0,skillId:29017,skillScale:1.7,stateSerial:9,sourceAdd:{dp:100,generator:{skillId:29017}}}),enemy={id:'enemy',x:400,y:0,z:0,hp:100,team:1};
 const state={actors:[a,enemy],effects:[{id:1,ownerId:'a',name:'DAMAGE_EFFECT_Ultimate_Fury_Generate'}],nextEffectId:2};
 const sim={state,profileFor:()=>p,note:()=>{},emit:()=>{},effectBoneSampler:(e,a,b)=>e.name==='DAMAGE_EFFECT_Ultimate_Fury_Generate'?[-200,150,0]:(e.currentAnchor??e.birthAnchor).position,effectAnchorSampler:()=>null,createEffect:(a,d,o)=>{const e={id:state.nextEffectId++,ownerId:a.id,name:d.NAME,definition:{...d},skillId:a.skillId,powerMultiplier:a.skillScale,birthAnchor:o.birthAnchor};state.effects.push(e);return e;}};
 startAddFury(sim,a);tickAddFury(sim,a,1/120);assert.equal(state.effects.filter(e=>e.sourceAddFury?.role==='beam').length,0);
 a.skillId=null;a.skillScale=1;tickAddFury(sim,a,1/120);
 const beams=state.effects.filter(e=>e.sourceAddFury?.role==='beam');assert.equal(beams.length,3);assert.ok(beams.every(e=>e.powerMultiplier===1.7));
 for(const e of beams){validateAddFuryEffectState(e,'MM',state.actors);assert.equal(e.definition.SCALE_Y,2);assert.equal(e.definition.SCALE_Z,2);assert.ok(Math.abs(e.definition.SCALE_X-Math.hypot(600,-150)/950)<1e-10);assert.equal(addLinkedDefinition(p,e,{NAME:e.name}).SCALE_X,e.definition.SCALE_X);}
 enemy.x=501;tickAddFury(sim,a,1/120);assert.ok(beams.every(e=>e.dead));
 a.sourceAdd.dp=0;tickAddFury(sim,a,1/120);assert.ok(state.effects.filter(e=>e.sourceAddFury).every(e=>e.dead));
 assert.throws(()=>validateAddFuryEffectState({...beams[0],sourceAddFury:null},'MM'),/state object/);
 assert.throws(()=>validateAddFuryEffectState(beams[0],'LP'),/identity/);
});

test('Phase Shift keeps target 8.8s dummy and exchanges through original nearest geometry once',()=>{
 const p=profiles.lp,a=actor('lp','ANSI_A_AN_PHASE_SHIFT',{hp:100,lineId:0,skillId:29216,stateSerial:3,mp:20}),state={effects:[]};
 const sim={profileFor:()=>p,state,map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},createEffect:(a,d,o)=>{const e={ownerId:a.id,ownerStateSerial:a.stateSerial,name:d.NAME,birthAnchor:o.birthAnchor};state.effects.push(e);return e;},nativeGeometry:{nearest:({position})=>({found:true,point:[position[0],position[1]+30,position[2]]})},emit:()=>{}};
 addRecastEvents(sim,a,0,.1);assert.equal(state.effects[0].lifeTimeSeconds,8.8);assert.deepEqual(a.sourceAddCombat.phase.position,[0,0,0]);
 const plan=addRecastResourcePlan(a,p.skillCatalog.find(s=>s.skillId===29216),{mode:'cast',dpCost:20},{profile:p});assert.equal(plan.mpCost,5);assert.equal(plan.dpCost,0);assert.equal(plan.ignoreCooldown,true);
 a.x=200;a.state='ANSI_A_AN_PHASE_SHIFT_BLINK';addRecastStateStart(sim,a);assert.deepEqual([a.x,a.y,a.z],[0,30,0]);assert.equal(a.grounded,false);assert.deepEqual(state.effects[0].currentAnchor.position,[200,0,0]);assert.equal(a.sourceAddCombat.phase,null);
 a.sourceAddCombat.phase={position:[0,0,0],remaining:1,group:3,skillId:29216};state.effects[0].dead=true;tickAddRecasts(sim,a,1/120);assert.equal(a.sourceAddCombat.phase,null);
});

test('Quicksilver return uses source open/closed window and original two final impact offsets',()=>{
 const p=profiles.lp,skill=p.skillCatalog.find(s=>s.skillId===29011),a=actor('lp',skill.state,{mp:10,lineId:0,sourceAdd:{formation:true,mutation:2}});
 for(const [time,expected]of [[.25,'cast'],[.25001,'quicksilver-back'],[.75,'quicksilver-back'],[.75001,'cast']]){a.animationTime=time;assert.equal(addRecastResourcePlan(a,skill,{mode:'cast'},{profile:p}).mode,expected);}
 const hits=[],sim={profileFor:()=>p,map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},effectAnchorSampler:()=>({position:[0,100,0]}),createEffect:(a,d,o)=>hits.push([d.NAME,o.birthAnchor.position]),emit:()=>{}};
 const hooks={consumeMutation:a=>{a.sourceAdd.mutation--;return 1;}};
 addRecastEvents(sim,a,.79,.8,hooks);assert.deepEqual(hits[0],['DamageEffect_ALP_Quicksilver_Accel_Impact_Stun',[250,150,0]]);
 a.state='ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK';addRecastEvents(sim,a,.59,.596,hooks);assert.deepEqual(hits[1],['DamageEffect_ALP_Quicksilver_Accel_Impact_Stun',[100,130,0]]);assert.equal(a.sourceAdd.mutation,0);
});

test('Stasis uses target2016 weighted storage, ordered release events and queried current-cost refund',()=>{
 const p=profiles.lp,skill=p.skillCatalog.find(s=>s.skillId===29007),a=actor('lp',skill.state,{hp:100,hpMax:1000,mp:0,mpMax:330,skillId:29007,skillScale:1,stateSerial:4,lineId:0,loadout:[{skillId:29007}]}),hits=[],sets=[],state={effects:[],nextEffectId:1};
 const sim={profileFor:()=>p,state,map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},skillAvailability:()=>({mpCost:300}),fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},spawnSet:(a,n)=>sets.push(n),createEffect:(a,d)=>{hits.push(d.NAME);return {definition:d};},emit:()=>{},note:()=>{}};
 addRecastStateStart(sim,a);addStasisDamageObserved(a,200);addStasisDamageObserved(a,50,{received:true});assert.equal(a.sourceAddCombat.stasis.hitValue,200);assert.equal(a.sourceAddCombat.stasis.damageValue,250);
 assert.equal(addRecastResourcePlan(a,skill,{mpCost:300},{profile:p}).mode,'stasis-release');assert.equal(addRecastResourcePlan(a,skill,{mpCost:300},{profile:p}).mpCost,0);
 a.state='ANSI_SA_APT_STASIS_FIELD_ACTIVE';addRecastStateStart(sim,a);addRecastEvents(sim,a,0,.01);addRecastEvents(sim,a,.29,.3);assert.equal(a.sourceAddCombat.stasis,null);assert.deepEqual(hits,['DamageEffect_APT_Stasis_Field_Activate']);assert.equal(p.damageEffects[hits[0]].raw.DAMAGE_DATA.DAMAGE.MAGIC,52.5);
 a.state=skill.state;addRecastStateStart(sim,a);tickAddRecasts(sim,a,10);assert.ok(sets.includes('EffectSet_SA_APT_STASIS_FIELD_Count_Down'));tickAddRecasts(sim,a,5);assert.ok(Math.abs(a.mp-100)<1e-5);assert.equal(a.sourceAddCombat.stasis,null);
});

test('Hidden Records changes carrier lifetime, preserves hit counts and honors target Pylon20s',()=>{
 const p=profiles.mm,a=actor('mm','RSI_WAIT',{passivePolicy:initializeAddPassives(p,{nativeValues})}),sim={profileFor:()=>p};
 const drone={name:'DamageEffect_AAT_Rushing_Drone',lifeTimeSeconds:2,damage:{DAMAGE_TIME:1}};applyAddDynamoDuration(sim,a,drone);assert.equal(drone.lifeTimeSeconds,Math.fround(2.6));assert.equal(drone.damage.DAMAGE_TIME,1);
 const pylon={name:'DamageEffect_APT_Pylon_Dynamo',lifeTimeSeconds:9999};applyAddDynamoDuration(sim,a,pylon);assert.equal(pylon.lifeTimeSeconds,26);
 const hit={name:'DamageEffect_AAT_Rushing_Drone_Explosion',lifeTimeSeconds:.2};applyAddDynamoDuration(sim,a,hit);assert.equal(hit.lifeTimeSeconds,.2);
 applyAddDynamoDuration({profileFor:()=>profiles.lp},actor('lp','RSI_WAIT'),pylon);assert.equal(pylon.lifeTimeSeconds,20);
});
test('Configuration mutation selects original eight-way/bomb variants and never creates a free second Rushing drone',()=>{
 const p=profiles.mm,a=actor('mm','ANSI_A_AAT_RUSHING_DRONE_DYNAMO',{skillContext:{addMutationSpent:0},sourceAdd:{formation:true,mutation:3},passivePolicy:initializeAddPassives(p,{nativeValues})});let next=1;const effects=[],sets=[];
 const sim={profileFor:()=>p,state:{effects,get nextEffectId(){return next;}},map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0],enabled:true,type:0}]},effectAnchorSampler:()=>({position:[0,50,0]}),fire:(a,id,t,b,e,fn)=>{if(b<t&&e>=t)fn();},emit:()=>{},note:()=>{},createEffect:(a,def,options)=>{const e={id:next++,ownerId:a.id,name:def.NAME,definition:def,powerMultiplier:1,lifeTimeSeconds:2,...options};effects.push(e);return e;},spawnSet:(a,name)=>sets.push(name)};
 a.lineId=0;addDynamoEvents(sim,a,.3,.7);assert.equal(effects.length,1);
 a.skillContext.addMutationSpent=1;addDynamoEvents(sim,a,.3,.7);assert.equal(effects.length,3);assert.equal(effects.at(-1).birthAnchor.rotation[1],30);
 const consumeMutation=(a,n)=>{a.sourceAdd.mutation-=n;return n;};
 a.state='ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO';addDynamoEvents(sim,a,.3,.5,{consumeMutation});assert.equal(effects.at(-1).name,'DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation');
 a.state='ANSI_A_AMM_COUNTDOWN_BOMB_DYNAMO';addDynamoEvents(sim,a,.2,.4,{consumeMutation});assert.equal(effects.at(-1).name,'DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation');
 a.state='ANSI_A_AMM_FLICK_DISC_DYNAMO';addDynamoEvents(sim,a,.2,.4,{consumeMutation});assert.deepEqual(sets,ADD_DYNAMO_RESOURCE_ROOTS.FlickDisc.slice(1));assert.equal(a.sourceAdd.mutation,0);
 for(const roots of Object.values(ADD_DYNAMO_RESOURCE_ROOTS))for(const name of roots)assert.ok(p.damageEffects[name]||p.effectSets[name],name);
 const raw=p.damageEffects.DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation.raw;assert.equal(Object.values(raw).filter(v=>v?.DAMAGE_EFFECT_NAME==='DamageEffect_ADD_Dividing_Missile_Dynamo_Small').length,8);
});
test('Mind Control uses target chance and spent-cost fraction, and excludes free recasts',()=>{
 const p=profiles.de,a=actor('de','RSI_WAIT',{mp:100,mpMax:300,sourceHitSeed:3227,passivePolicy:initializeAddPassives(p,{nativeValues})}),skill=p.skillCatalog.find(s=>s.skillId===29019);let dpDelta=0;
 const sim={profileFor:()=>p,state:{seed:999},rng:()=>{throw Error('original getter does not advance combat RNG');},emit:()=>{},note:()=>{}};
 assert.equal(applyAddMindControlRefund(sim,a,skill,{mode:'cast',formation:false,mpCost:200,dpCost:0}),20);assert.equal(a.mp,120);
 a.sourceHitSeed=0;assert.equal(applyAddMindControlRefund(sim,a,skill,{mode:'cast',formation:false,mpCost:200,dpCost:0}),0);
 a.sourceHitSeed=3227;assert.equal(applyAddMindControlRefund(sim,a,skill,{mode:'cast',formation:true,mpCost:0,dpCost:1600},{changeDp:(a,delta)=>{dpDelta=delta;return delta*1.5;}}),240);assert.equal(dpDelta,160);
 assert.equal(applyAddMindControlRefund(sim,a,skill,{mode:'phase-return',formation:false,mpCost:5,dpCost:0}),0);assert.equal(sim.state.seed,999);
 assert.equal(a.passivePolicy.add.mindControlDebuffDurationMultiplier,.5);assert.equal(a.passivePolicy.add.mindControlDebuffTemplateIds.includes(1),false);
});

test('Enhanced Rushing explosion radius is derived identically from frozen skill identity',async()=>{
 const {addDynamoInstanceDefinition}=await import('../../packages/combat-core/add-dynamo-effect-state.mjs');
 const source={NAME:'DamageEffect_AAT_Rushing_Drone_Explosion',SCALE_X:2},e={name:source.NAME,skillId:29219};
 assert.deepEqual(addDynamoInstanceDefinition(profiles.mm,e,source),{NAME:source.NAME,SCALE_X:2.6,SCALE_Y:1.3,SCALE_Z:1.3});
 assert.equal(addDynamoInstanceDefinition(profiles.mm,{...e,skillId:29208},source),source);
 assert.equal(addDynamoInstanceDefinition(profiles.lp,e,source),source);assert.deepEqual(source,{NAME:e.name,SCALE_X:2});
});
