/** Explicit user tuning; independently calculated assertions are not original
 * client recordings. Actual native casts exercise the shared penalty budget. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcProductionFixture,vcProductionPreset,runDeadlyRaid} from '../helpers/vc-production-fixture.mjs';
import {burnVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const near=(a,b,t=.06)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const shell='RAVEN_REVOLVER_CANNON_SHELL_OVERHEAT',command='RWT_COMBO_XXX_LOOP_OVERHEAT';
const dt=1/60;
function run(f,frames=780,heat=true){
  const events=[];
  for(let i=0;i<frames;i++){
    f.sim.step(dt,{vc:{pressed:i===0||heat&&i<190&&i%2===0?['A']:[]}},{snapshot:false});
    events.push(...f.sim.drainEvents());
  }
  return events;
}
test('production preset freezes command2x, skill25x, per-tier15% and passive hard protection',()=>{
  assert.deepEqual(vcProductionPreset.overheatHpCostMultipliers,{command:2,skill:25});
  assert.equal(vcProductionPreset.overheatSkillLayerHpCap,.15);assert.equal(vcProductionPreset.overheatHardProtection,true);
  const {a}=vcProductionFixture();assert.equal(a.hpMax,233337);near(a.passivePolicy.veteran.noDamageBelow,.21,1e-6);
});
for(const awake of[false,true])test(`independent skill/command arithmetic, awake=${awake}`,()=>{
  for(const [name,kind,extra,rawMagic,pvp,multiplier]of[[shell,'skill',1,6.2272,.6,25],[command,'command',.5,1.46,1,2]]){
    const {sim,a}=vcProductionFixture(),hp=a.hp,mp=a.mp;if(awake)a.awakening.remaining=30;
    const amount=burnVeteranOverheat(sim,a,name,{kind,extra,power:1});
    near(amount,1667*rawMagic*pvp*.2*extra*.6*multiplier*(awake?1.2:1));
    near(hp-a.hp,amount);assert.equal(a.mp,mp);
    assert.equal(sim.drainEvents().filter(e=>e.type==='hit').length,0);
    assert.equal(sim.state.events.some(e=>e.name==='Critical_Hit.wav'),false);
  }
});
for(const kind of['command','skill'])test(`25% cannot burn below21%, including huge ${kind} cost`,()=>{
  const {sim,a}=vcProductionFixture();a.hp=Math.fround(a.hpMax*.25);
  assert.ok(burnVeteranOverheat(sim,a,shell,{kind,power:10000})>0);
  near(a.hp/a.hpMax,.21,1e-7);const hp=a.hp;
  assert.equal(burnVeteranOverheat(sim,a,shell,{kind,power:10000}),0);assert.equal(a.hp,hp);
});
for(const fraction of[.21,.20,.02])test(`at/below21% heat has no HP cost or accidental healing (${fraction})`,()=>{
  const {sim,a}=vcProductionFixture();a.hp=Math.fround(a.hpMax*fraction);const hp=a.hp;
  assert.equal(burnVeteranOverheat(sim,a,shell,{power:10000}),0);assert.equal(a.hp,hp);
});
for(const survive of[false,true])test(`hard floor belongs only to24412, survival=${survive}`,()=>{
  const {sim,a}=vcProductionFixture({actor:{passives:survive?[24414]:[],guildPassives:[]}});a.hp=100;
  burnVeteranOverheat(sim,a,command,{kind:'command',power:10000});assert.equal(a.hp,survive?1:0);
});
test('15% budget accumulates over callbacks and loop state serials; commands do not consume it',()=>{
  const {sim,a}=vcProductionFixture();a.skillId=24020;a.skillContext={castStep:10};const hp=a.hp;
  for(let i=0;i<20;i++){a.stateSerial++;burnVeteranOverheat(sim,a,shell,{power:100});}
  const spent=hp-a.hp;assert.ok(spent<=a.hpMax*.15);near(spent,a.hpMax*.15);
  assert.equal(a.sourceVeteranCommander.overheatCostBudget.layerKey,'single');
  const after=a.hp;assert.equal(burnVeteranOverheat(sim,a,shell,{power:100}),0);
  assert.ok(burnVeteranOverheat(sim,a,command,{kind:'command',extra:.5,power:1})>0);
  assert.ok(a.hp<after);assert.equal(a.sourceVeteranCommander.overheatCostBudget.spent,spent);
  a.skillContext.castStep++;assert.ok(burnVeteranOverheat(sim,a,shell,{power:100})>0,'next cast renews its budget');
});
test('three Deadly Raid states have three independent tier caps, still obeying21% floor',()=>{
  const {sim,a}=vcProductionFixture();a.skillId=24024;a.skillContext={castStep:10};const hp=a.hp;
  for(const [i,state]of['RVC_SI_SA_DEADLY_RAID_LOOP','RVC_SI_SA_DEADLY_RAID_FINISH_READY','RVC_SI_SA_DEADLY_RAID_FINISH'].entries()){
    a.state=state;a.stateSerial=100+i;const before=a.hp;
    burnVeteranOverheat(sim,a,shell,{power:100});assert.ok(before-a.hp<=a.hpMax*.15);near(before-a.hp,a.hpMax*.15);
    assert.equal(burnVeteranOverheat(sim,a,shell,{power:100}),0);
  }
  near(hp-a.hp,a.hpMax*.45);
});
for(const id of[24031,24034,24020,24021,24022,24023,24024])for(const awake of[false,true])test(`actual skill${id} native cast, awake=${awake}:25x and cumulative per-tier bounds`,()=>{
  const f=vcProductionFixture({preset:{loadout:[{skillId:id},...Array(7).fill(null)]}}),{a}=f;
  if(awake)a.awakening.remaining=30;
  if(id===24031){a.y+=450;a.grounded=false;a.lineId=null;f.sim.enter(a,'RSI_JUMP_DOWN','independent air-only cast setup');}
  const events=run(f),penalties=events.filter(e=>e.type==='overheatHpChanged');
  assert.equal(events.filter(e=>e.type==='skillStarted').length,1);assert.ok(penalties.length>0);
  assert.ok(penalties.every(e=>e.kind==='skill'&&e.hpCostMultiplier===25&&e.layerSpent<=a.hpMax*.15));
  assert.equal(a.state,'RSI_WAIT');assert.ok(a.hp>=a.hpMax*.21-.02);
});
for(const mode of['xxx','air','flame'])test(`actual ${mode} command heat uses2x exclusively`,()=>{
  const f=vcProductionFixture(),events=[];
  for(let i=0;i<600;i++){
    let held=[],pressed=[];
    if(mode==='xxx'){if(i<175&&i%9===0)pressed=['X'];}
    else if(i===0){held=['RIGHT'];pressed=['DASH','RIGHT'];}
    else if(i===1&&mode==='air'){held=['RIGHT'];pressed=['UP'];}
    else if(i<180){held=mode==='flame'?['Z']:[];if(i>2&&i%7===3)pressed=[mode==='flame'?'Z':'X'];}
    f.sim.step(dt,{vc:{held,pressed}},{snapshot:false});events.push(...f.sim.drainEvents());
  }
  const penalties=events.filter(e=>e.type==='overheatHpChanged');assert.ok(penalties.length>0);
  assert.ok(penalties.every(e=>e.kind==='command'&&e.hpCostMultiplier===2));assert.equal(f.a.state,'RSI_WAIT');
});
for(const id of[24020,24034])test(`actual extended skill${id} cannot reset15% budget on loop/extra-shell state changes or JSON restore`,()=>{
  // An explicitly oversized test multiplier makes the protection bind;
  // this isolated test input is never presented as original balancing data.
  const f=vcProductionFixture({preset:{loadout:[{skillId:id},...Array(7).fill(null)],overheatHpCostMultipliers:{command:2,skill:25000}}});
  const hp=f.a.hp,events=[];let restored=false;
  for(let i=0;i<780;i++){
    f.sim.step(dt,{vc:{pressed:i===0||i<190&&i%2===0?['A']:[]}},{snapshot:false});events.push(...f.sim.drainEvents());
    if(!restored&&f.sim.actor('vc').sourceVeteranCommander?.overheatCostBudget?.spent>0){
      f.sim.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));
      // Snapshots retain the last frame's already observed event list.
      f.sim.drainEvents();restored=true;
    }
  }
  const a=f.sim.actor('vc'),cost=hp-a.hp;assert.ok(restored);assert.ok(cost<=a.hpMax*.15);near(cost,a.hpMax*.15);
  assert.equal(a.state,'RSI_WAIT');
  const penalties=events.filter(e=>e.type==='overheatHpChanged');
  assert.ok(penalties.every(e=>e.layerKey==='single'&&e.layerSpent<=a.hpMax*.15),'all callbacks share one budget, including float32 rounding remainder');
  near(penalties.reduce((n,e)=>n+e.amount,0),cost);
});
test('JSON snapshot and owned-state preserve partially spent budget; malformed budget is rejected',()=>{
  const f=vcProductionFixture(),g=vcProductionFixture();f.a.skillId=24024;f.a.skillContext={castStep:10};
  burnVeteranOverheat(f.sim,f.a,shell,{power:1});
  const snapshot=JSON.parse(JSON.stringify(f.sim.snapshot()));f.sim.restore(snapshot);const a=f.sim.actor('vc');
  const saved=structuredClone(a.sourceVeteranCommander.overheatCostBudget);
  const report=encodeOwnedState(f.sim,a.id,{frameSeq:8});validateOwnedState(report);applyOwnedState(g.sim,'vc',report);
  assert.deepEqual(g.a.sourceVeteranCommander.overheatCostBudget,saved);
  for(const actor of[a,g.a])actor.skillContext={castStep:10};
  const spent=burnVeteranOverheat(f.sim,a,shell,{power:100}),remote=burnVeteranOverheat(g.sim,g.a,shell,{power:100});near(spent,remote);
  assert.ok(a.sourceVeteranCommander.overheatCostBudget.spent<=a.hpMax*.15);
  for(const invalid of[NaN,-1,Infinity]){const bad=structuredClone(report);bad.actor.sourceVeteranCommander.overheatCostBudget.spent=invalid;assert.throws(()=>validateOwnedState(bad));}
});
for(const awake of[false,true])test(`default three-tier Raid independent25x total, awake=${awake}`,()=>{
  const r=runDeadlyRaid({awake});assert.equal(r.penalties.length,3);assert.equal(r.activationCount,3);
  // Independent target declarations: all three LARGE penalty identities use
  // MAGIC3.6835, PvP.6; target buff217 adds7.3%/stack, capped at two stacks.
  const attackFactors=[1.073,1.146,1.146];
  near(r.cost,attackFactors.reduce((s,v)=>s+1667*v*3.6835*.6*.2*.6*25*(awake?1.2:1),0),2);
});
