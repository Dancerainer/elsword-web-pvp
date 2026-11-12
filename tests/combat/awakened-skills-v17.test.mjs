import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeAwakenedSkills,skillsModule} from '../helpers/rf-awakened-skills-v17-fixture.mjs';
import {profile as baseProfile} from '../helpers/rf-passive-fixture-v12.mjs';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const dt=1/60,tick=(s,input={})=>s.step(dt,input,{snapshot:false});
const source=JSON.parse(readFileSync(new URL('../../reports/rf-awakened-skills-source-v17.json',import.meta.url)));

test('independent target/source inventory retains absent old Hyper tables, shared callbacks and disabled900',()=>{
  assert.equal(source.targetClientMeasured,0);assert.equal(source.skills.length,20);
  const byId=id=>source.skills.find(x=>x.skillId===id);
  assert.equal(byId(24206).referenceRegistrations.length,0,'EnchantHand has no pinned registration; no invented alias');
  assert.equal(byId(900).status,'disabled-in-PvP');
  assert.equal(byId(24025).referenceRegistrations.find(x=>x.owner==='hyperStateData').targetTablePresent,false);
  assert.ok(byId(24027).referenceRegistrations.some(x=>x.owner==='hyperStateData'&&x.table==='RSI_SI2_POWER_ASSAULT'&&x.targetTablePresent));
  const entries=source.skills.flatMap(x=>x.targetClosure).filter(x=>x.modeFields.some(v=>v.field.endsWith('HYPER_NAME')));
  assert.deepEqual([...new Set(entries.map(x=>x.name))],['EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK']);
});

test('unchanged compiled WildCharge callback transports explicit live mode at original .01 threshold and resets each evaluation',async()=>{
  const native=await instantiateNativeSkills(skillsModule),exports=(await WebAssembly.instantiate(skillsModule)).exports;
  assert.equal(typeof exports.skills_effect_hyper_mask,'function');assert.equal(exports.skills_output_count(),33);
  const input={kind:3,time:.01,before:0,dt,hp:800000,hpMax:800000,power:1,charge:0};
  for(const remaining of [0,1,0,.0001,0]){
    const r=native.evaluate({...input,awakening:remaining});
    assert.equal(r.commands[0].name,'EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK');
    assert.equal(r.commands[0].hyperMode,remaining>0);assert.equal(r.effectHyperMask,remaining>0?2:0);
  }
  assert.deepEqual(native.evaluate({...input,time:.009,awakening:10}).commands,[]);
  assert.deepEqual(native.evaluate({...input,time:.02,before:.01,oneshot:.01,awakening:10}).commands,[]);
});

test('EffectSet saved mode survives delayed damage birth, expiry and JSON restore; omitted/empty Hyper names use source defaults',async()=>{
  const normal='SI_SA_RRF_WILD_CHARGE_ATTACK',hyper='SI_SA_RRF_WILD_CHARGE_ATTACK_HYPER';
  // Legal bounded EffectSet fixture uses real target damage names and a
  // delayed custom clock. It tests the source m_bHyper consumer, not new data.
  const diagnosticProfile={...baseProfile,effectSets:{...baseProfile.effectSets,DiagnosticSavedMode:{raw:{EVENT_TIMER_TYPE:1,
    EFFECT0:{NAME:normal,HYPER_NAME:hyper,TYPE:1,START_TIME:.3}}}}};
  const s=await makeAwakenedSkills({profile:diagnosticProfile,skillId:24009,positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
  a.awakening.remaining=.1;
  s.spawnSet(a,'DiagnosticSavedMode',1,[],true);const selected=s.state.effects.at(-1);assert.equal(selected.name,hyper);assert.equal(selected.hyperMode,true);
  s.spawnSet(a,'DiagnosticSavedMode',1);assert.equal(s.state.effects.at(-1).name,normal,'defaultfalse is independent of live awakening');
  s.createEffect(a,{NAME:normal,HYPER_NAME:''},{hyperMode:true});assert.equal(s.state.effects.at(-1).name,normal);
  const frozen=JSON.parse(JSON.stringify(s.snapshot()));
  const restored=await makeAwakenedSkills({profile:diagnosticProfile,skillId:24009});restored.restore(frozen);s.restore(frozen);s.drainEvents();restored.drainEvents();
  let born=false;
  for(let i=0;i<120;i++){tick(s);tick(restored);const e=s.drainEvents();assert.deepEqual(restored.drainEvents(),e);
    if(e.some(e=>e.type==='effectStarted'&&e.effectId===selected.id)){assert.equal(s.actor('rf').awakening.remaining,0);born=true;}
    assert.equal(JSON.stringify(s.snapshot()),JSON.stringify(restored.snapshot()));}
  assert.ok(born);
});

test('real A/release WildCharge samples live dash mode while XCrash retains cast mode across expiry at both facings',async()=>{
  for(const facing of [-1,1])for(const skillId of [24009,24010]){
    const s=await makeAwakenedSkills({skillId,positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');a.facing=facing;a.awakening.remaining=.1;s.drainEvents();
    const input=createInputBuffer();input.down('A',.002);tick(s,input.consume(dt));input.up('A',.021);
    const events=[];for(let i=0;i<200;i++){tick(s,input.consume(s.state.time+dt));events.push(...s.drainEvents());}
    assert.equal(a.awakening.remaining,0);
    if(skillId===24009){const c=events.find(e=>e.type==='originalSkillCommand'&&e.name==='EffectSet_RF_WILD_CHARGE_CHARGE_ATTACK');
      assert.ok(c);assert.equal(c.hyperMode,false);assert.ok(events.some(e=>e.type==='effectStarted'&&e.name==='SI_SA_RRF_WILD_CHARGE_ATTACK'));
      assert.ok(!events.some(e=>e.type==='effectStarted'&&e.name==='SI_SA_RRF_WILD_CHARGE_ATTACK_HYPER'));
    }else{assert.equal(events.filter(e=>e.type==='originalSkillCommand'&&e.name==='RRF_X_CRASH_NODAMAGE_HYPER').length,1);
      assert.ok(!events.some(e=>e.type==='originalSkillCommand'&&e.name==='RRF_X_CRASH_NODAMAGE'));}
  }
});
