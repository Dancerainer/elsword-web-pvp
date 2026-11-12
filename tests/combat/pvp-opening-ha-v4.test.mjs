/** User-requested Web match policy, not original-client measured defaults. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch,DEFAULT_PVP_RULES} from '../../packages/pvp/index.mjs';
import {MODE_CONFIG} from '../../packages/online/modes.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createPvpPractice} from '../../apps/web/pvp-practice.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const versions={referenceVersion:'ha-policy-fixture',presetVersion:'ha-policy-fixture',programVersion:'ha-policy-fixture'};
const loadout=[{skillId:24603},...Array(7).fill(null)];
function fixture(mode='2v2',rules={}){
  const spec=MODE_CONFIG[mode],players=Array.from({length:spec.playerCount},(_,i)=>({id:'p'+i,team:i<spec.teamSize?0:1,loadout}));
  const map={sceneId:'ha-policy-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
    starts:players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*1000,0,0],lineId:0,facingRight:true}))};
  const makeSimulation=({players:roster=players,seed=16}={})=>createSimulation({profile,map,actors:roster.map((p,i)=>({...p,position:p.position??[i*1000,0,0]})),seed,versions});
  const sim=makeSimulation(),templates=structuredClone(sim.state.actors);
  const pvp=new PvpMatch({players,map,mode,seed:16,versions:sim.versions,rules,onRespawn(id){
    const index=sim.state.actors.findIndex(a=>a.id===id);return sim.state.actors[index]=structuredClone(templates[index]);
  }});
  return {sim,pvp,players,map,makeSimulation};
}
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-8,`${value} != ${expected}`);

for(const mode of ['1v1','2v2','3v3'])test(`${mode} starts every player with HA180 once, preserving other cooldowns`,()=>{
  const {sim,pvp}=fixture(mode);
  for(const actor of sim.state.actors)actor.cooldowns={24027:7,24600:200,24603:9};
  pvp.start(sim);
  for(const actor of sim.state.actors)assert.deepEqual(actor.cooldowns,{24027:7,24600:180,24603:180});
  pvp.advance(4.5,sim);assert.equal(pvp.state.phase,'fight');
  for(const actor of sim.state.actors){assert.equal(actor.cooldowns[24603],180);actor.mp=300;}
  assert.equal(sim.skillAvailability('p0','A').reason,'cooldown');
  for(let i=0;i<60;i++){sim.step(1/60,{}, {snapshot:false});pvp.advance(1/60,sim);sim.drainEvents();pvp.drainEvents();}
  for(const actor of sim.state.actors){near(actor.cooldowns[24603],179);near(actor.cooldowns[24600],179);near(actor.cooldowns[24027],6);}
  pvp.advance(.1,sim);near(sim.actor('p0').cooldowns[24603],179,'room broadcasts cannot reset owner CD');
  assert.throws(()=>pvp.start(sim),/already started/);
  const again=new PvpMatch({players:pvp.state.players,map:pvp.map,mode,seed:17,versions:sim.versions});
  again.start(sim);assert.equal(sim.actor('p0').cooldowns[24603],180,'a new match receives a fresh opening delay');
});

test('owner intro epoch carries HA180 to the browser and repeated ready/state updates do not reset it',t=>{
  const {sim,pvp,players,makeSimulation}=fixture(),events=[];
  const driver=createLocalOwnerBattleDriver({match:{id:'ha-owner',players},simulation:sim,pvp,manual:true,clock:()=>0,
    emit:(type,value)=>events.push({type,value}),finish:()=>{}});t.after(()=>driver.stop());
  const receiver=makeSimulation(),sync=createLocalOwnershipSync();
  sync.reconcile(receiver,driver.snapshot(),'p0');assert.deepEqual(receiver.actor('p0').cooldowns,{});
  for(const player of players)driver.ready(player.id);
  const intro=driver.snapshot();assert.equal(intro.pvp.phase,'intro');assert.equal(intro.ownership.actors.p0.epoch,1);
  sync.reconcile(receiver,intro,'p0');assert.equal(receiver.actor('p0').cooldowns[24603],180);
  driver.tick(4.5);sync.reconcile(receiver,driver.snapshot(),'p0');receiver.step(1/60,{}, {snapshot:false});
  const remaining=receiver.actor('p0').cooldowns[24603];near(remaining,180-1/60);
  driver.ready('p0');driver.tick(.1);sync.reconcile(receiver,driver.snapshot(),'p0');
  assert.equal(receiver.actor('p0').cooldowns[24603],remaining);assert.equal(driver.snapshot().ownership.actors.p0.epoch,1);
});

for(const elapsed of [90,181])test(`respawn at ${elapsed}s preserves only remaining opening HA delay, not a fresh180`,()=>{
  const {sim,pvp}=fixture();pvp.start(sim);pvp.advance(4.5,sim);
  const player=pvp.player('p0');player.alive=false;player.respawnAt=5;pvp.state.fightTime=elapsed;
  sim.actor('p0').deathComplete=true;
  assert.equal(pvp.respawn(player,sim),true);
  if(elapsed<180){assert.equal(sim.actor('p0').cooldowns[24603],90);assert.equal(sim.actor('p0').cooldowns[24600],90);}
  else assert.deepEqual(sim.actor('p0').cooldowns,{});
  assert.equal(pvp.respawn(player,sim),false);
});

test('2v2 practice retains immediate HA availability; opening delay configuration rejects invalid values',()=>{
  const f=fixture();const practice=createPvpPractice({localId:'tester',loadout,map:f.map,createSimulation:f.makeSimulation});
  assert.equal(practice.state.rules.initialHaCooldown,0);
  for(const actor of practice.simulation.state.actors)assert.deepEqual(actor.cooldowns,{});
  practice.step(4.5,{});assert.equal(practice.state.phase,'fight');
  const actor=practice.simulation.actor('tester');actor.mp=300;actor.inputLock=0;
  assert.equal(practice.simulation.skillAvailability('tester','A').available,true);practice.stop();
  assert.equal(DEFAULT_PVP_RULES.initialHaCooldown,180);
  for(const value of [-1,NaN,Infinity,'180'])assert.throws(()=>fixture('2v2',{initialHaCooldown:value}),/initialHaCooldown/);
});
