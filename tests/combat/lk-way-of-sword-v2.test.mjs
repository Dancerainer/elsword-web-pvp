import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {wayOfSwordHitPolicy,wayOfSwordMpCost,wayOfSwordRageCost,wayOfSwordRageEligible,advanceDestructionRage} from '../../packages/combat-core/lk-way-of-sword.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLordKnightResourcePools} from '../../packages/combat-core/lord-knight.mjs';
const lk=JSON.parse(readFileSync(process.env.LK_PROFILE_FIXTURE??new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const rf=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const empty=()=>Array(8).fill(null),map={sceneId:'sword-consumer-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}]};
const original=JSON.parse(readFileSync(new URL('../../reports/lk-wos-source-probe-v2.json',import.meta.url)));
function fixture(){const sim=createSimulation({profile:lk,profiles:{LK:lk,RF:rf},map,preset:{loadout:empty(),guildPassives:[],passives:[]},presets:{RF:{loadout:empty(),guildPassives:[],passives:[]}},actors:[
  {id:'lk',professionId:'LK',team:0,x:0,y:0,loadout:empty()},{id:'rf',professionId:'RF',team:1,x:100,y:0,loadout:empty()}]});return {sim,a:sim.actor('lk'),b:sim.actor('rf')};}
const damage=type=>({DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,ATTACK_TYPE:2,HIT_ADD_MP:8,STOP_TIME_DEF:0,STOP_TIME_ATT:0,WAY_OF_SWORD_TYPE:type});
test('production policy matches all independently compiled unmodified SwordMan/DamageManager cases',()=>{
  assert.equal(original.evidenceClass,'compiled-fixedV5-source-not-target2016');assert.equal(original.assertionsPassed,110);
  for(const row of original.cases.hits)assert.deepEqual(wayOfSwordHitPolicy({professionId:'LK',wayOfSword:{state:row.state}},damage(row.type)),{damage:row.damage,mp:row.mp});
});
test('fixed Elsword consumers use vitality 3/4, destruction 2/1.5 and never activate on RF',()=>{
  for(const state of [-2,-1,0,1,2])for(let type=0;type<=6;type++){
    const p=wayOfSwordHitPolicy({professionId:'LK',wayOfSword:{state}},damage(type));
    assert.equal(p.mp,state===2?(type===1?3:[2,3].includes(type)?4:1):1);
    assert.equal(p.damage,state===-2?(type===4?2:[5,6].includes(type)?1.5:1):1);
    assert.deepEqual(wayOfSwordHitPolicy({professionId:'RF',wayOfSword:{state}},damage(type)),{mp:1,damage:1});
  }
});
test('target skill type 2 receives exact float MP discount; other types and RF do not',()=>{
  const a={professionId:'LK',wayOfSword:{state:2}};
  assert.equal(wayOfSwordMpCost(a,{raw:{m_usWOSType:2}},30),21);
  for(const type of [0,1,undefined])assert.equal(wayOfSwordMpCost(a,{raw:{m_usWOSType:type}},30),30);
  assert.equal(wayOfSwordMpCost({...a,professionId:'RF'},{raw:{m_usWOSType:2}},30),30);
});
test('active vitality increases real command hit MP and consumes target vitality points',()=>{
  const {sim,a}=fixture();sim.applyWayOfSwordDelta(a,4800,'fixture');a.mp=0;
  const hit=sim.injectHit({attackerId:'lk',targetId:'rf',damageData:damage(1)});
  assert.equal(hit.accepted,true);assert.equal(a.mp,24);assert.equal(a.wayOfSword.state,2);
  assert.equal(a.wayOfSword.point,Math.fround(4800+Math.fround(Math.fround(67.2)*Math.fround(-1.2))));
});
test('the hit consuming the final vitality points still gets 3x MP, later hits do not',()=>{
  const {sim,a,b}=fixture();sim.applyWayOfSwordDelta(a,4800,'fixture');sim.applyWayOfSwordDelta(a,-4799,'fixture');a.mp=0;
  sim.injectHit({attackerId:'lk',targetId:'rf',damageData:damage(1)});assert.equal(a.mp,24);assert.equal(a.wayOfSword.state,-1);
  b.invincible=false;b.forceInvincible=0;sim.injectHit({attackerId:'lk',targetId:'rf',damageData:damage(1)});assert.equal(a.mp,32);
});
test('vitality skill pricing is shared by HUD query and real cast',()=>{
  const {sim,a}=fixture();sim.configureLoadout([{skillId:21219},...empty().slice(1)],'lk');sim.applyWayOfSwordDelta(a,4800,'fixture');
  a.mp=300;const expected=Math.fround(lk.skillCatalog.find(s=>s.skillId===21219).mpCost*Math.fround(.7));
  const availability=sim.skillAvailability('lk',0);assert.equal(availability.mpCost,expected);assert.equal(availability.available,true);
  sim.step(1/60,{lk:{pressed:['A']}});assert.equal(a.mp,300-expected);assert.equal(a.skillId,21219);
});
test('vitality received MP doubles while received target points are consumed',()=>{
  const base=fixture(),active=fixture();active.sim.prepareWayOfSword('lk',2);base.a.mp=active.a.mp=0;
  base.sim.injectHit({attackerId:'rf',targetId:'lk',damageData:damage(0)});active.sim.injectHit({attackerId:'rf',targetId:'lk',damageData:damage(0)});
  assert.ok(base.a.mp>0);assert.equal(active.a.mp,base.a.mp*2);assert.equal(active.a.wayOfSword.point,4728);
});
test('destruction modifies real normal and active/special damage before its points are consumed',()=>{
  for(const [type,multiplier]of [[4,2],[5,1.5],[6,1.5],[1,1]]){
    const base=fixture(),active=fixture();active.sim.applyWayOfSwordDelta(active.a,-4800,'fixture');
    const x=base.sim.injectHit({attackerId:'lk',targetId:'rf',damageData:damage(type)}),y=active.sim.injectHit({attackerId:'lk',targetId:'rf',damageData:damage(type)});
    assert.equal(y.amount,x.amount*multiplier);if(type>=4)assert.ok(active.a.wayOfSword.point>-4800);
  }
});
test('destruction ground reaction costs target PvP 1500x1.5 and only the initial hit has +100 reduction',()=>{
  const {sim,a}=fixture();sim.applyWayOfSwordDelta(a,-4800,'fixture');
  const first=sim.injectHit({attackerId:'rf',targetId:'lk',damageData:damage(0)});
  assert.equal(first.amount,0);assert.equal(a.state,'ESSI_DESTRUCTION_RAGE');assert.equal(a.wayOfSword.point,-2550);assert.equal(a.destructionRageRemaining,6);assert.equal(a.superArmor,true);
  const second=sim.injectHit({attackerId:'rf',targetId:'lk',damageData:damage(0)});
  assert.ok(second.amount>0);assert.equal(a.state,'ESSI_DESTRUCTION_RAGE');assert.equal(a.destructionRageRemaining,6);
  assert.equal(sim.state.events.filter(e=>e.type==='destructionRageStarted').length,1);
  for(let i=0;i<370;i++)sim.step(1/60,{});
  assert.equal(a.destructionRageRemaining,0);assert.equal(a.superArmor,false);
});
test('rage is ineligible in air, normal armor, own cooldown, dummy/sensor/no-damage and RF',()=>{
  const a={professionId:'LK',wayOfSword:{state:-2},grounded:true,hp:10,superArmor:false};assert.equal(wayOfSwordRageEligible(a,damage(1)),true);
  for(const extra of [{grounded:false},{superArmor:true},{destructionRageRemaining:1},{hp:0},{invincible:true},{professionId:'RF'}])assert.equal(wayOfSwordRageEligible({...a,...extra},damage(1)),false);
  for(const type of [0,7,10])assert.equal(wayOfSwordRageEligible(a,{REACT_TYPE:type}),false);
  assert.equal(wayOfSwordRageCost(lk),2250);assert.equal(wayOfSwordRageCost(lk,{pvp:false}),1500);
});
test('rage timer pauses for independent armor and is not a permanent armor refresh',()=>{
  const a={professionId:'LK',wayOfSword:{state:-2},superArmor:true,destructionRageRemaining:2};advanceDestructionRage(a,1);assert.equal(a.destructionRageRemaining,2);
  a.superArmor=false;advanceDestructionRage(a,1);assert.equal(a.destructionRageRemaining,1);assert.equal(a.superArmor,true);
  a.superArmor=false;advanceDestructionRage(a,1.1);assert.equal(a.destructionRageRemaining,0);assert.equal(a.superArmor,false);
});
test('sword activation/zero/reversal updates original wait and effect lifecycle while preserving input',()=>{
  assert.ok(lk.states.ESSI_SWORD_WAIT,'target profile closure must include the real SwordWait state');
  const {sim,a}=fixture();sim.applyWayOfSwordDelta(a,4800,'fixture');assert.equal(a.state,'ESSI_SWORD_WAIT');assert.equal(a.animationName,'Wait_W0');
  sim.step(1/60,{lk:{pressed:['Z']}});assert.equal(a.state,'RSI_COMBO_Z');sim.enter(a,'RSI_WAIT','fixture');assert.equal(a.state,'ESSI_SWORD_WAIT');
  sim.applyWayOfSwordDelta(a,-4800,'fixture');assert.equal(a.state,'RSI_WAIT');assert.equal(a.animationName,'Wait');
  sim.applyWayOfSwordDelta(a,-4800,'fixture');assert.equal(a.state,'ESSI_SWORD_WAIT');assert.equal(a.animationName,'Wait_W1');
  a.hp=a.hpMax*.25;sim.enter(a,'RSI_WAIT','fixture');assert.equal(a.animationName,'Fatal');
  sim.applyWayOfSwordDelta(a,9600,'fixture');assert.equal(a.wayOfSword.state,2);
  const sets=sim.state.events.filter(e=>e.type==='effectSet').map(e=>e.name);
  assert.deepEqual(sets.filter(s=>/EffectSet_(Vigor|Destruction)(Start|End)/.test(s)),['EffectSet_VigorStart','EffectSet_VigorEnd','EffectSet_DestructionStart','EffectSet_DestructionEnd','EffectSet_VigorStart']);
});
test('rage state and effect ownership roundtrip online and deterministic restore rejects RF spoof',()=>{
  const f=fixture(),g=fixture();f.sim.applyWayOfSwordDelta(f.a,-4800,'fixture');f.sim.injectHit({attackerId:'rf',targetId:'lk',damageData:damage(0)});
  const report=encodeOwnedState(f.sim,'lk');validateOwnedState(report);validateOwnedReferences(report,f.a,lk,map);applyOwnedState(g.sim,'lk',report);assert.equal(g.a.destructionRageRemaining,6);
  g.sim.restore(f.sim.snapshot());for(let i=0;i<100;i++){f.sim.step(1/60,{});g.sim.step(1/60,{});assert.deepEqual(f.sim.snapshot(),g.sim.snapshot());}
  const bad=encodeOwnedState(f.sim,'rf');bad.actor.destructionRageRemaining=6;assert.throws(()=>validateOwnedReferences(bad,f.b,rf,map),/invalid-rf-way/);
});
test('explicit practice preparation uses lifecycle and death ends the original active mode once',()=>{
  const {sim,a}=fixture();assert.deepEqual(sim.prepareWayOfSword('lk',-2),{point:-4800,state:-2});
  assert.throws(()=>sim.prepareWayOfSword('rf',2),/LK practice/);assert.throws(()=>sim.prepareWayOfSword('lk',1),/LK practice/);
  sim.prepareWayOfSword('lk',0);assert.equal(a.state,'RSI_WAIT');sim.prepareWayOfSword('lk',2);
  a.hp=0;sim.enter(a,'RSI_DIE_FRONT','fixture');sim.enter(a,'RSI_DIE_FRONT','fixture-repeat');
  assert.equal(sim.state.events.filter(e=>e.type==='effectSet'&&e.name==='EffectSet_VigorEnd').length,1);
});
test('charging sides change gauge without restarting an idle animation',()=>{
  const {sim,a}=fixture();a.animationTime=.3;const serial=a.stateSerial;
  sim.applyWayOfSwordDelta(a,100,'fixture');sim.applyWayOfSwordDelta(a,-200,'fixture');sim.applyWayOfSwordDelta(a,100,'fixture');
  assert.equal(a.stateSerial,serial);assert.equal(a.animationTime,.3);
});
for(const mode of [-2,2])for(const lead of [0,1,2])test(`real LK actor respawn restores sword lifecycle mode ${mode}, lead ${lead}`,()=>{
  const {sim,a}=fixture(),clean=structuredClone(a),spawnMap={...map,spawns:[
    {kind:'SetTeamStartPos',teamFlag:1,position:[0,0,0],lineId:0,facingRight:1,index:0},
    {kind:'SetTeamStartPos',teamFlag:0,position:[100,0,0],lineId:0,facingRight:0,index:1}]};
  const match=new PvpMatch({mode:'1v1',map:spawnMap,players:[{id:'lk',team:0},{id:'rf',team:1}],
    versions:{referenceVersion:'target',presetVersion:'fixture',programVersion:'fixture'},rules:{respawnEnabled:true},specialResourcePools:createLordKnightResourcePools(),
    onRespawn(id){const actor=structuredClone(clean);sim.state.actors[sim.state.actors.findIndex(a=>a.id===id)]=actor;return actor;}});
  sim.prepareWayOfSword('lk',mode);a.hp=0;sim.enter(a,'RSI_DIE_FRONT','fixture');a.deathComplete=true;
  const player=match.player('lk');player.alive=false;player.respawnAt=0;match.state.phase='fight';match.state.score=[lead,0];
  sim.drainEvents();assert.equal(match.respawn(player,sim),true);const restored=sim.actor('lk');
  assert.equal(restored.hp,restored.hpMax);assert.equal(restored.destructionRageRemaining,0);
  assert.equal(restored.wayOfSword.point,lead===0?mode*2400:0);
  assert.equal(restored.wayOfSword.state,lead===0?Math.sign(mode):0);
  assert.equal(restored.state,'RSI_WAIT');
  assert.ok(!sim.state.events.some(e=>e.type==='effectSet'&&/Start$/.test(e.name)));
  assert.ok(sim.state.events.some(e=>e.type==='wayOfSwordChanged'&&e.kind==='respawn-resource-restore'));
  validateOwnedReferences(encodeOwnedState(sim,'lk'),restored,lk,map);
});
