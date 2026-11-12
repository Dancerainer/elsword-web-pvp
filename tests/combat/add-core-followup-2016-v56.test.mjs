/** Independently decoded32771560/32745d30 branches. Buff342 rows below are
 * explicit instance inputs, never a claim that the missing13 producer ran. */
import test from 'node:test';
import assert from 'node:assert/strict';
import source from '../../contracts/add-core-followup-source-v56.json' with {type:'json'};
import {addFixture,tick} from '../helpers/add-fixture.mjs';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {addInstallationExtensionPlan2016,applyAddInstallationExtension2016} from '../../packages/combat-core/add-core-passives-v56.mjs';
import {addAcceptedHit,addNasodRequest} from '../../packages/combat-core/add-nasod.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
const keys=(pressed=[])=>({pressed:new Set(pressed),held:new Set(pressed),pureDoubleLeft:false,pureDoubleRight:false});
const record=remaining=>({schemaVersion:1,templateId:342,behaviors:[{kind:'empty'}],displayer:{},
 finalizers:[{kind:'time',remaining,sourceDuration:remaining}]});
const transition={oldMode:29013,newMode:29016};

test('installation extension reads last actual342 TIME plus original70b4; never the independent generator clock',()=>{
 const {a,profile}=addFixture('MM',{passives:[29407]});
 a.sourceAdd.generator={remaining:500};a.buffs=[record(25),{templateId:1,finalizers:[{kind:'time',remaining:100}]},record(4.25)];
 const raw=structuredClone(profile.buffFactors[366].raw),r=addInstallationExtensionPlan2016(a,profile,transition);
 assert.equal(r.supported,true);assert.equal(r.apply,true);assert.equal(r.remaining,4.25);
 assert.equal(r.extra,source.installation.level3Extra);assert.equal(r.duration,24.25);
 assert.equal(r.factor.BUFF_TEMPLET_ID,342);assert.equal(r.factor.FINALIZER.BFT_TIME.NORMAL_TIME[3],24.25);
 assert.deepEqual(profile.buffFactors[366].raw,raw,'per-request float does not rewrite original catalog');
 assert.equal(a.buffs[2].finalizers[0].remaining,4.25);
 a.buffs=[];assert.equal(addInstallationExtensionPlan2016(a,profile,transition).apply,false);
});
for(const remaining of [0,-1])test(`installation last matching${remaining} overrides an earlier positive record`,()=>{
 const {a,profile}=addFixture('MM',{passives:[29407]});a.buffs=[record(5),record(remaining)];
 const r=addInstallationExtensionPlan2016(a,profile,transition);assert.equal(r.apply,false);assert.equal(r.remaining,remaining);
});
test('installation does not invent mode, Buff vector, timer or an unlearned passive',()=>{
 const {a,profile}=addFixture('MM',{passives:[29407]});a.buffs=[record(4)];
 for(const t of [{oldMode:null,newMode:29016},{oldMode:29016,newMode:29016}])assert.equal(addInstallationExtensionPlan2016(a,profile,t).apply,false);
 assert.equal(addInstallationExtensionPlan2016(a,profile,{...transition,records:null}).supported,false);
 a.buffs=[{templateId:342,finalizers:[]},{templateId:342,finalizers:[{kind:'state',remaining:1}]}];
 assert.equal(addInstallationExtensionPlan2016(a,profile,transition).apply,false);
 a.buffs=[record(4)];delete a.passivePolicy.skillLevels[29407];assert.equal(addInstallationExtensionPlan2016(a,profile,transition).apply,false);
});
test('actual BF366 application fails closed at undecompiled finalizer13 and leaves existing342 unchanged',()=>{
 const {sim,a}=addFixture('MM',{passives:[29407]});a.buffs=[record(4)];const before=structuredClone(a.buffs);
 const r=applyAddInstallationExtension2016(sim,a,transition);
 assert.equal(r.duration,24);assert.equal(r.applied,false);assert.equal(r.reason,'original-bf366-finalizer13-unavailable');
 assert.deepEqual(a.buffs,before);assert.ok(a.unsupported.some(row=>JSON.stringify(row).includes('X2STATE_CHANGE')));
});
test('actual native MM switch issues original remaining+20 request only from a supplied342 record; remote producer stays closed',()=>{
 const {sim,a}=originalAddFixture('MM',{skillId:29013,passives:[29407]});
 a.loadout[1]={skillId:29016,requestedSkillId:29016,level:1,branchId:'none'};a.sourceAdd.dp=8000;
 const requests=[],grant=sim.grantBuff.bind(sim);sim.grantBuff=(...args)=>{
  if(args[2]?.BUFF_TEMPLET_ID===342){requests.push(args[2]);return null;}return grant(...args);
 };
 sim.step(1/60,{add:{pressed:['A'],held:['A']}});tick(sim,2.5);
 assert.equal(requests.length,0,'first selection has no old mode and no fabricated342');
 assert.ok([29013,29035].includes(a.sourceAdd.generator.skillId),'production selector retains selected Flick branch alias');
 // Explicit decoded original342 instance. The missing13 producer is not
 // replaced by the independent current Web generator.remaining field.
 a.buffs=[record(6.5)];sim.step(1/60,{add:{pressed:['S'],held:['S']}});
 assert.equal(a.sourceAdd.generator.skillId,29016);assert.equal(requests.length,1);
 assert.equal(requests[0].FINALIZER.BFT_TIME.NORMAL_TIME[3],Math.fround(Math.fround(6.5-Math.fround(1/60))+20),
  'Buff frame precedes command payment; read the current instance after its one delta');
 sim.networkOwnerId='target';assert.equal(applyAddInstallationExtension2016(sim,a,transition).apply,false);assert.equal(requests.length,1);
});

function armorFixture({passives=[29410],formed=false,points=1}={}){
 const f=originalAddFixture('DE',{passives});const {sim,a,b}=f;
 sim.enter(a,'ANSI_COMBO_ZZZX','explicit-native129-instance');
 a.sourceAdd.formation=formed;a.sourceAdd.mutation=points;a.animationStopped=false;
 a.sourceAddCombat={nasodTargetId:b.id,nasodFlag:false};return {...f,profile:sim.profileFor(a)};
}
test('Overlimit native129 latches fresh input, keeps equality threshold, consumes1 before requesting156',()=>{
 const {a,profile}=armorFixture();const window=source.normalArmor.window;
 a.animationTime=window[0];assert.equal(addCommands.runEvent(a,keys(['Z']),profile).state,null);
 assert.equal(a.sourceAddCombat.nasodFlag,true);assert.equal(a.sourceAdd.mutation,1);
 a.animationTime=window[2];assert.equal(addCommands.runEvent(a,keys(),profile).state,null);assert.equal(a.sourceAdd.mutation,1);
 a.animationTime=window[2]+.00001;const r=addCommands.runEvent(a,keys(),profile);
 assert.equal(r.state,'ANSI_COMBO_NASOD_ARMOR_READY');assert.equal(a.state,'ANSI_COMBO_ZZZX','caller has not approved/applied request');
 assert.equal(a.sourceAdd.mutation,0);assert.equal(a.sourceAddCombat.nasodFlag,false);
 assert.equal(addCommands.runEvent(a,keys(),profile).state,null,'same latch cannot charge a second time');
});
test('ordinary native129 needs learned Overlimit and positive points only when making the latch; formed route does not charge',()=>{
 for(const options of [{passives:[]},{points:0}]){
  const {a,profile}=armorFixture(options);a.animationTime=.5;addCommands.runEvent(a,keys(['X']),profile);
  assert.equal(a.sourceAddCombat.nasodFlag,false);a.animationTime=.734;assert.equal(addCommands.runEvent(a,keys(),profile).state,null);
 }
 const {a,profile}=armorFixture({passives:[],formed:true});a.animationTime=.5;addCommands.runEvent(a,keys(['Z']),profile);
 a.animationTime=.734;assert.equal(addCommands.runEvent(a,keys(),profile).state,'ANSI_COMBO_NASOD_ARMOR_READY');assert.equal(a.sourceAdd.mutation,1);
});
test('normal129 lost point after latch still sends original-1 and Mind Circle sees that request before clamping',()=>{
 const {a,profile}=armorFixture({passives:[29410,29413]});a.animationTime=.5;addCommands.runEvent(a,keys(['Z']),profile);
 a.equipmentAttributes.addDpGainBonus=0; // Explicit neutral option, not an inferred original default.
 a.sourceAdd.mutation=0;a.sourceAdd.dp=100;a.animationTime=.734;
 assert.equal(addCommands.runEvent(a,keys(),profile).state,'ANSI_COMBO_NASOD_ARMOR_READY');
 assert.equal(a.sourceAdd.mutation,0);assert.equal(a.sourceAdd.dp,100+source.normalArmor.mindCircleLevel3Dp*20);
});
test('normal129 retains original model-ended/air/target/window exclusions and does not widen other ordinary states',()=>{
 const {a,profile}=armorFixture();const def=profile.states[a.state];
 a.animationTime=.766;addNasodRequest(a,def,profile,keys(['Z']));assert.equal(a.sourceAddCombat.nasodFlag,false,'upper input edge excluded');
 a.animationTime=.5;addNasodRequest(a,def,profile,keys(['Z']));a.animationTime=.734;a.sourceAddCombat.nasodTargetId=null;
 assert.equal(addNasodRequest(a,def,profile,keys()),null);assert.equal(a.sourceAdd.mutation,1);
 a.sourceAddCombat.nasodTargetId='target';a.animationStopped=true;assert.equal(addCommands.runEvent(a,keys(),profile).state,'RSI_WAIT');assert.equal(a.sourceAdd.mutation,1);
 a.animationStopped=false;a.grounded=false;assert.equal(addCommands.runEvent(a,keys(),profile).state,'RSI_JUMP_DOWN');assert.equal(a.sourceAdd.mutation,1);
 a.grounded=true;a.sourceAddCombat.nasodFlag=false;a.animationTime=.5;
 assert.equal(addNasodRequest(a,{...def,sourceState:'ANSI_SA_AN_VOID_BREAKER'},profile,keys(['Z'])),null);assert.equal(a.sourceAddCombat.nasodFlag,false);
});
test('real target sampling plus host callback spends ordinary129 point before entering READY exactly once',()=>{
 const {sim,a,b,profile}=armorFixture();a.sourceAddCombat.nasodTargetId=null;
 assert.equal(addAcceptedHit(sim,a,b,{CAN_ACTIVATE_NASOD_ARMOR_COMBO:1}),true);b.x=5000;
 const enter=sim.enter.bind(sim),costAtReady=[];sim.enter=(actor,state,...args)=>{
  if(state==='ANSI_COMBO_NASOD_ARMOR_READY')costAtReady.push(actor.sourceAdd.mutation);
  return enter(actor,state,...args);
 };
 a.animationTime=.5;sim.step(1/60,{add:{pressed:['Z'],held:['Z']}});
 assert.equal(a.sourceAddCombat.nasodFlag,true);assert.equal(a.sourceAdd.mutation,1);
 for(let i=0;i<25&&a.sourceAdd.mutation>0;i++)sim.step(1/60,{});
 assert.equal(a.sourceAdd.mutation,0);assert.equal(a.state,'ANSI_COMBO_NASOD_ARMOR_READY');assert.deepEqual(costAtReady,[0]);
 assert.equal(a.sourceAdd.mutation,0);assert.equal(profile.states[a.state].sourceState,'ANSI_COMBO_NASOD_ARMOR_READY');
});

test('DE-only real Z Z Z X then fresh Z reaches sampled156 without LP profile or manually entering any command',()=>{
 const samplers=originalAddSamplers('DE'),{sim,a,b}=addFixture('DE',{passives:[29410],
  samplers:{...samplers,profiles:{DE:PROFESSION_PROFILES.DE}}});
 assert.deepEqual(Object.keys(sim.profiles),['DE']);a.sourceAdd.mutation=1;b.x=5000;
 const entered=[],enter=sim.enter.bind(sim);sim.enter=(actor,state,...args)=>{if(actor===a)entered.push(state);return enter(actor,state,...args);};
 const step=pressed=>sim.step(1/60,pressed?{add:{pressed:[pressed],held:[pressed]}}:{});
 const until=(predicate,message)=>{for(let i=0;i<240&&!predicate();i++)step();assert.ok(predicate(),message+'; '+JSON.stringify({
  state:a.state,t:a.animationTime,combat:a.sourceAddCombat,positions:[[a.x,a.y,a.z],[b.x,b.y,b.z]],
  hits:sim.state.events.filter(e=>e.type==='hit').slice(-3),unsupported:a.unsupported,
  effects:sim.state.events.filter(e=>['effectStarted','hitRejected'].includes(e.type)).slice(-5)}));};
 step('Z');until(()=>a.state==='RSI_COMBO_Z','first realZ');
 until(()=>a.animationTime>=.05,'Z input window');step('Z');until(()=>a.state==='RSI_COMBO_ZZ','second realZ');
 until(()=>a.animationTime>=.2,'ZZ input window');step('Z');until(()=>a.state==='RSI_COMBO_ZZZ','third realZ');
 until(()=>a.animationTime>=.4,'ZZZ X input window');step('X');until(()=>a.state==='ANSI_COMBO_ZZZX','realX selects native129');
 Object.assign(b,{x:a.x+250,y:a.y,z:a.z,grounded:true,lineId:a.lineId,lastTouchLineId:a.lastTouchLineId,
  landPosition:[a.x+250,a.y,a.z],vx:0,vy:0});
 until(()=>a.animationTime>=.5&&a.sourceAddCombat?.nasodTargetId===b.id,'original effect collider captures target before armor input');
 assert.ok(a.animationTime<.766,'fresh input is inside original129 window');step('Z');
 until(()=>a.state==='ANSI_COMBO_NASOD_ARMOR_READY','normal armor request156');
 assert.equal(a.sourceAdd.mutation,0);assert.ok(entered.includes('ANSI_COMBO_NASOD_ARMOR_READY'));
 const pose=samplers.defenderSampler(a,{profile:sim.profileFor(a)});assert.ok(pose?.length>0,'actual DE NA_Ready helper shape exists');
 until(()=>entered.includes('ANSI_COMBO_NASOD_ARMOR_ATTACK'),'156 model end requests157 with DE resources');
 assert.ok(!a.unsupported.some(row=>/pose|helper|state:ANSI_COMBO_NASOD_ARMOR/.test(row.id)),JSON.stringify(a.unsupported));
});
