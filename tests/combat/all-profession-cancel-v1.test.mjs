import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cancelProfiles,cancelAuditFixture,cancelAuditInput} from '../helpers/cancel-audit-fixture.mjs';
import {ravenCommandCancel} from '../../packages/combat-core/raven-command-cancels.mjs';
import {afterCancel,skillCommandCancel} from '../../packages/combat-core/skill-command-cancels.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
const skillCases=[['RF',24203,'RSI_A_RF_MEGADRILL_BREAK',2.2],['RF',24218,'RSI_A_RWT_FLAME_SWORD_GROUND',.566],
  ['LK',21203,'ESSI_A_ELK_IMPACT_SMASH',1.22],['RS',21208,'ESSI_A_ES_SWORD_WAVE',1.2],
  ['BM',24210,'RSI_A_RBM_SONIC_SLASH_FINISH',.6],['BM',24015,'RSI_SA_RBM_GIGA_DRIVE_BURST',2.272],
  ['IS',21221,'ESSI_A_ETK_SWORD_SHIELD',.9],['IS',21213,'ESSI_SI_A_EIS_FATAL_SLAP',.7],
  ['IS',21214,'ESSI_SI_A_EIS_SPIRAL_STING',1.2],['IS',21023,'ESSI_SI_SA_EIS_RAGE_CUTTER',1.9]];
function atState(id,skillId,state,at,extra={}){
  const f=cancelAuditFixture(id,{skillId,followSkillId:skillId===21029?21217:skillId===21217?21029:id==='RF'||id==='VC'||id==='BM'?24217:21029,...extra});
  f.sim.step(dt,{actor:{held:['A'],pressed:['A']}},{snapshot:false});
  if(f.a.state!==state)f.sim.enter(f.a,state,'independent-source-boundary-fixture');
  f.a.animationTime=at;f.a.animationBeforeTime=at;f.a.worldStop=0;f.a.hitStop=0;f.a.inputLock=0;
  f.sim.drainEvents();return f;
}
test('named source gates disable negatives/nonfinite values and compare binary32 strictly',()=>{
  for(const value of[-1,NaN,Infinity,undefined])assert.equal(afterCancel(10,value),false);
  assert.equal(afterCancel(.566,.566),false);assert.equal(afterCancel(.566+1e-10,.566),false);
  assert.equal(afterCancel(.566001,.566),true);
});
for(const [id,skill,state,at]of skillCases)for(const facing of[-1,1]){
  test(`${id} ${state}: physical66 uses target ${at}, strict clock, both facings`,()=>{
    const f=atState(id,skill,state,at,{facing}),d=f.profile.states[state],key=facing>0?'RIGHT':'LEFT';
    assert.equal(d.raw.DASH_CANCEL_AFTER,at,'independent target declaration');
    const input=cancelAuditInput([key],[],facing>0?{pureDoubleRight:true}:{pureDoubleLeft:true});
    assert.equal(skillCommandCancel(f.a,d,input)?.facing,undefined);
    f.a.animationTime=at+.0001;assert.equal(skillCommandCancel(f.a,d,input)?.facing,facing);
    f.sim.processInput(f.a,input);assert.equal(f.a.state,'RSI_DASH');assert.equal(f.a.skillId,null);
    validateOwnedState(encodeOwnedState(f.sim,'actor'));
    const blocked=atState(id,skill,state,at+.0001,{facing});blocked.a.buffControls={dashBlock:true};
    assert.notEqual(skillCommandCancel(blocked.a,blocked.profile.states[state],input)?.state,'RSI_DASH');
  });
}
for(const facing of[-1,1])for(const direction of[-1,1])test(`RF MegaDrill WALK requests WAIT and retains facing ${facing}, input ${direction}`,()=>{
  const f=atState('RF',24203,'RSI_A_RF_MEGADRILL_BREAK',2.3,{facing}),key=direction>0?'RIGHT':'LEFT';
  assert.equal(f.profile.states[f.a.state].raw.WALK_CANCEL_AFTER,2.3);
  f.sim.step(1e-9,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});assert.equal(f.a.state,'RSI_A_RF_MEGADRILL_BREAK');
  f.a.animationTime=2.3001;f.sim.step(1e-9,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});
  assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.facing,facing);assert.equal(f.a.skillId,null);
  f.sim.step(dt,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,direction);
});
for(const id of['RF','VC','BM'])for(const facing of[-1,1])test(`${id} actual Z→ZZ→ZZZ consumes shared backward .45 and retains fourth Z`,()=>{
  const f=cancelAuditFixture(id,{facing}),buffer=createInputBuffer({sampledLevels:true});
  const tick=()=>f.sim.step(dt,{actor:buffer.consume(f.sim.state.time+dt)},{snapshot:false});
  const edge=(key,down)=>{buffer[down?'down':'up'](key,f.sim.state.time+.001);tick();};
  const until=pred=>{for(let i=0;i<180&&!pred();i++)tick();assert.ok(pred(),f.a.state);};
  edge('Z',true);edge('Z',false);edge('Z',true);edge('Z',false);until(()=>f.a.state==='RSI_COMBO_ZZ');
  edge('Z',true);edge('Z',false);until(()=>f.a.state==='RSI_COMBO_ZZZ');
  const saved=structuredClone(f.sim.state);edge(facing>0?'LEFT':'RIGHT',true);
  until(()=>f.a.state!=='RSI_COMBO_ZZZ');assert.equal(f.a.state,'RSI_WAIT');
  assert.equal(f.a.facing,facing);assert.ok(f.sim.state.time-saved.time<.45/(f.a.stats.animationSpeedMultiplier||1)+.1);
  f.sim.restore(saved);f.a=f.sim.actor('actor');buffer.clear();
  edge('Z',true);edge('Z',false);until(()=>f.a.state==='RSI_COMBO_ZZZZ');
});
const heldSkips=[['LK',21029,'ESSI_SI1_ES_ASSAULT_SLASH',1.1,'Z',false],['RS',21029,'ESSI_SI1_ES_ASSAULT_SLASH',1.1,'X',false],
  ['IS',21029,'ESSI_SI1_ES_ASSAULT_SLASH',1.1,'Z',false],['LK',21007,'ESSI_SA_ESK_DOUBLE_SLASH',3.667,'X',true],
  ['RS',21220,'ESSI_SA_EMK_BIG_BURST',1.06,'Z',true],['BM',24209,'RSI_A_ROT_ARMOR_BREAK',.66,'X',false],
  ['BM',24211,'RSI_A_RST_CUT_TENDON',.66,'Z',false],['VC',24215,'RSI_A_RF_BREAKING_FIST',.62,'X',false],
  ['LK',21009,'ESSI_SA_ELK_SAND_STORM',1.45,'Z',false],['RF',24204,'RSI_A_ROT_WEAPON_BREAK',.66,'Z',false]];
for(const [id,skill,state,at,key,inclusive]of heldSkips)test(`${id} ${state}: held ${key} source skip ${inclusive?'>=':'>'}${at}`,()=>{
  const f=atState(id,skill,state,at),d=f.profile.states[state],input=cancelAuditInput([key]);
  assert.equal(!!skillCommandCancel(f.a,d,input),inclusive);
  f.a.animationTime=at+.0001;f.sim.processInput(f.a,input);assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.skillId,null);
});
for(const [id,skill,state,at]of skillCases.filter(r=>!r[2].includes('GIGA')))test(`${id} ${state}: ground skill macro also accepts fresh awakening`,()=>{
  const f=atState(id,skill,state,0),limit=f.profile.states[state].raw.SKILL_CANCEL_AFTER;f.a.awakening.orbs=1;
  f.a.animationTime=limit;f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,state);
  f.a.animationTime=limit+.0001;f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,'RSI_HYPER_MODE');
});
for(const id of['RF','BM'])test(`${id} Flame Sword fly uses target .475 air-skill gate without granting air awakening`,()=>{
  const f=atState(id,24218,'RSI_A_RWT_FLAME_SWORD_FLY',.475,{air:true});f.a.grounded=false;f.a.lineId=null;
  assert.equal(f.sim.skillAvailability('actor',1).available,false);
  f.a.animationTime=.475001;assert.equal(f.sim.skillAvailability('actor',1).available,true);
  f.a.awakening.orbs=1;f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,'RSI_A_RWT_FLAME_SWORD_FLY');
});
test('Auto Guard keeps Roll-only phases and consumes the recovered small-end .1 minimum without changing raw .01',()=>{
  const state='ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL';
  const f=atState('LK',21203,state,Math.fround(.1));
  assert.equal(f.profile.states[state].raw.SKILL_CANCEL_AFTER,.01);
  assert.equal(f.sim.skillAvailability('actor',1).available,false);
  f.a.animationTime=.100001;assert.equal(f.sim.skillAvailability('actor',1).available,true);
  for(const rollOnly of ['ESSI_SI_P_ESK_AUTO_GUARD','ESSI_SI_P_ESK_AUTO_GUARD_END']){
    f.sim.enter(f.a,rollOnly);assert.equal(f.sim.skillAvailability('actor',1).available,false);
  }
});
test('source inventory keeps throw-velocity and sheath-frame fields separate from cancellation calls',()=>{
  const source=JSON.parse(readFileSync(new URL('../../contracts/all-profession-cancel-source-v1.json',import.meta.url)));
  assert.equal(source.summary.states,871);assert.equal(source.targetClientMeasured,false);
  const throwState=source.groups.find(g=>g.sourceState==='ESSI_THROW_ITEM');assert.equal(throwState.fields.WALK_CANCEL_AFTER,1700);
  const xx=source.groups.find(g=>g.sourceState==='ESSI_ETK_COMBO_XX');
  assert.ok(!xx.consumers.some(c=>c.calls.some(call=>call.macro==='DASH_CANCEL_AFTER')));
});
for(const facing of[-1,1])test(`BM actual X→XX→XXX shares the user-authorized RF blast and recovers, facing ${facing}`,()=>{
  const f=cancelAuditFixture('BM',{facing}),buffer=createInputBuffer({sampledLevels:true});
  const tick=()=>f.sim.step(dt,{actor:buffer.consume(f.sim.state.time+dt)},{snapshot:false});
  const tap=()=>{buffer.down('X',f.sim.state.time+.001);tick();buffer.up('X',f.sim.state.time+.001);tick();};
  const until=pred=>{for(let i=0;i<180&&!pred();i++)tick();assert.ok(pred(),f.a.state);};
  tap();tap();until(()=>f.a.state==='RSI_COMBO_XX');tap();until(()=>f.a.state==='RSI_COMBO_XXX');
  assert.ok(f.a.xxxCandidate);until(()=>f.a.state==='RSI_WAIT');assert.equal(f.a.xxxCandidate,undefined);
});

// Expected numbers are independently reparsed target declarations. These
// explicit target-only adapters remain qualified where V6 callbacks are absent.
const ravenWindows=[['RSI_COMBO_ZZ','BWALK_CANCEL_AFTER',.6],['RSI_COMBO_ZZZZ','WALK_CANCEL_AFTER',.8],
  ['RSI_COMBO_ZZZZ','DASH_CANCEL_AFTER',.566],['RSI_COMBO_ZZXX','DASH_CANCEL_AFTER',.6],
  ['RSI_DASH_JUMP_COMBO_ZZ_Landing','DASH_CANCEL_AFTER',.2],['RRF_COMBO_ZZXFRONTXX','DASH_CANCEL_AFTER',1.15],
  ['RSI_OVER_TAKER_COMBO_XXdownX','BWALK_CANCEL_AFTER',.5],['RSI_OVER_TAKER_COMBO_XXfrontXX4','DASH_CANCEL_AFTER',.9],
  ['RSI_OVER_TAKER_COMBO_XXfrontXXdownX','BWALK_CANCEL_AFTER',.5]];
for(const [state,field,limit]of ravenWindows)for(const facing of[-1,1])test(`RF ${state} ${field} preserves strict ${limit} / facing ${facing}`,()=>{
  const f=cancelAuditFixture('RF',{facing});f.sim.enter(f.a,state,'reviewed-target-command-boundary');
  const d=f.profile.states[state];assert.equal(d.raw[field],limit);
  const dash=field==='DASH_CANCEL_AFTER',direction=field==='BWALK_CANCEL_AFTER'?-facing:facing;
  const input=cancelAuditInput([direction>0?'RIGHT':'LEFT'],[],dash?direction>0?{pureDoubleRight:true}:{pureDoubleLeft:true}:{});
  for(const at of[limit-.0001,limit]){f.a.animationTime=at;assert.equal(ravenCommandCancel(f.a,d,input),null);}
  f.a.animationTime=limit+.0001;
  f.sim.processInput(f.a,input);assert.equal(f.a.state,dash?'RSI_DASH':'RSI_WAIT');assert.equal(f.a.facing,facing);
  validateOwnedState(encodeOwnedState(f.sim,'actor'));
});
for(const id of['VC','BM'])test(`${id} shares RF's exact original ZZ/ZZXX movement declarations`,()=>{
  const f=cancelAuditFixture(id),states=['RSI_COMBO_ZZ','RSI_COMBO_ZZXX'];
  for(const state of states){assert.deepEqual(cancelProfiles[id].states[state].raw,cancelProfiles.RF.states[state].raw);
    f.sim.enter(f.a,state);f.a.animationTime=.6001;f.sim.processInput(f.a,cancelAuditInput(['LEFT']));assert.equal(f.a.state,'RSI_WAIT');}
});
test('reviewed Raven windows leave buffered combo and simultaneous attack priority intact; dash-block cannot become backward recovery',()=>{
  const f=cancelAuditFixture('RF');f.sim.enter(f.a,'RSI_COMBO_ZZXX');f.a.animationTime=.61;
  const d=f.profile.states[f.a.state],double=cancelAuditInput(['LEFT'],[],{pureDoubleLeft:true});
  f.a.cancelInput={stage:'pending'};assert.equal(ravenCommandCancel(f.a,d,double),null);f.a.cancelInput=null;
  assert.equal(ravenCommandCancel(f.a,d,cancelAuditInput(['LEFT','X'],['X'],{pureDoubleLeft:true})),null);
  f.a.buffControls={dashBlock:true};f.sim.processInput(f.a,double);assert.equal(f.a.state,'RSI_COMBO_ZZXX');
});
for(const id of['RF','VC','BM'])test(`${id} common Maximum Cannon requires a fresh Z/X at target 1.65`,()=>{
  const f=atState(id,24025,'RSI_SI1_MAXIMUM_CANNON',1.65),d=f.profile.states[f.a.state];assert.equal(d.raw.ATTACK_CANCEL_AFTER,1.65);
  const fresh=cancelAuditInput(['X'],['X']);assert.equal(skillCommandCancel(f.a,d,fresh),null);
  f.a.animationTime=1.6501;assert.equal(skillCommandCancel(f.a,d,cancelAuditInput(['X'])),null);
  f.sim.processInput(f.a,fresh);assert.equal(f.a.state,'RSI_COMBO_X');assert.equal(f.a.skillId,null);
});
test('skill awakening obeys world-stop and input locks and survives JSON restoration',()=>{
  const f=atState('RF',24203,'RSI_A_RF_MEGADRILL_BREAK',2.2001);f.a.awakening.orbs=1;
  const saved=JSON.parse(JSON.stringify(f.sim.snapshot()));
  for(const lock of['worldStop','hitStop','inputLock']){
    f.a[lock]=1;f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,'RSI_A_RF_MEGADRILL_BREAK');f.a[lock]=0;
  }
  f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));const first=f.sim.snapshot();
  f.sim.restore(saved);f.a=f.sim.actor('actor');f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));
  assert.deepEqual(f.sim.snapshot(),first);
});
for(const [id,state,limit]of[['RF','RSI_PARRYING',.3],['VC','RSI_PARRYING',.3],['BM','RSI_PARRYING',.3],
  ['RF','RRF_DASH_JUMP_COMBO_XX_LANDING',.4],['VC','RSI_COMBO_XX',.466]]){
  test(`${id} ${state}: reviewed literal ${limit} opens fresh skill input without a guessed raw field`,()=>{
    const f=atState(id,id==='VC'?24221:id==='BM'?24210:24203,state,limit);
    assert.equal(Object.hasOwn(f.profile.states[state].raw,'SKILL_CANCEL_AFTER'),false);
    assert.equal(f.sim.skillAvailability('actor',1).available,false);
    f.a.animationTime=limit+.0001;assert.equal(f.sim.skillAvailability('actor',1).available,true);
    const expected=f.a.loadout[1].skillId;f.sim.processInput(f.a,cancelAuditInput(['S'],['S']));assert.equal(f.a.skillId,expected);
  });
  if(state!=='RSI_COMBO_XX')test(`${id} ${state}: enabled ground macro also accepts fresh awakening >${limit}`,()=>{
    const f=atState(id,id==='VC'?24221:id==='BM'?24210:24203,state,limit);f.a.awakening.orbs=1;
    f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,state);
    f.a.animationTime=limit+.0001;f.sim.processInput(f.a,cancelAuditInput(['AWAKEN'],['AWAKEN']));assert.equal(f.a.state,'RSI_HYPER_MODE');
  });
}
for(const facing of [-1,1])test(`VC standing Barrage .93 literal enables only direction and keeps skill/awakening closed, facing ${facing}`,()=>{
  const state='RSI_A_RWT_BARRAGE_ATTACK_STAND',key=facing>0?'RIGHT':'LEFT';
  const f=cancelAuditFixture('VC',{skillId:24221,followSkillId:24217,facing});
  f.sim.enter(f.a,state,'independent-source196-boundary');f.a.awakening.orbs=1;
  assert.equal(Object.hasOwn(f.profile.states[state].raw,'SKILL_CANCEL_AFTER'),false);
  f.a.animationTime=Math.fround(.93);
  f.sim.step(1e-9,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});
  assert.equal(f.a.state,state);assert.equal(f.a.sourcePendingState,undefined,'strict equality stays closed');
  f.a.animationTime=.9301;
  assert.equal(f.sim.skillAvailability('actor',1).available,false,'missing S consumes9999 rather than the direction literal');
  f.sim.step(1e-9,{actor:{sampledDevice:true,held:['S','AWAKEN'],pressed:['S','AWAKEN']}},{snapshot:false});
  assert.equal(f.a.state,state);assert.equal(f.a.sourcePendingState,undefined);assert.equal(f.a.skillId,null);assert.equal(f.a.awakening.orbs,1);
  f.sim.step(1e-9,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});
  assert.equal(f.a.state,state);assert.equal(f.a.sourcePendingState?.state,'RSI_WALK');
  f.sim.step(1e-9,{actor:{sampledDevice:true,held:[key],pressed:[]}},{snapshot:false});
  assert.equal(f.a.state,'RSI_WALK');assert.equal(f.a.facing,facing);
});
for(const facing of[-1,1])test(`VC actual X→XX physical double consumes reviewed .466 dash branch, facing ${facing}`,()=>{
  const f=cancelAuditFixture('VC',{facing}),buffer=createInputBuffer({sampledLevels:true});
  const tick=()=>f.sim.step(dt,{actor:buffer.consume(f.sim.state.time+dt)},{snapshot:false});
  const edge=(key,down)=>{buffer[down?'down':'up'](key,f.sim.state.time+.001);tick();};
  const until=pred=>{for(let i=0;i<180&&!pred();i++)tick();assert.ok(pred(),f.a.state);};
  edge('X',true);edge('X',false);until(()=>f.a.animationTime>.1);edge('X',true);edge('X',false);until(()=>f.a.state==='RSI_COMBO_XX');
  until(()=>f.a.animationTime>.466);const key=facing>0?'RIGHT':'LEFT';
  edge(key,true);edge(key,false);edge(key,true);assert.equal(f.a.state,'RSI_DASH');assert.equal(f.a.facing,facing);
});
