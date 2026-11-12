import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createPvpPractice} from '../../apps/web/pvp-practice.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
async function fixture(networkOwnerId=null){
  const {native,samplers}=await assets.createRuntime();
  const practice=createPvpPractice({localId:'tester',nickname:'Local Tester',loadout:Array(8).fill(null),map:assets.map,
    createSimulation:({players,seed})=>createSimulation({profile:assets.profile,map:assets.map,actors:players,seed,
      preset:{...assets.preset,onlineMatch:true,passives:[],guildPassives:[],attributes:{...assets.preset.attributes,damageReduction:0}},
      networkOwnerId,...samplers,nativeGeometry:native.geometry,nativeCommands:native.commands,
      nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,
      nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions})});
  return practice;
}
function fight(p){for(let i=0;i<300&&p.state.phase==='intro';i++)p.step(1/60,{});assert.equal(p.state.phase,'fight');}
const hitData=structuredClone(assets.profile.states.RSI_DASH_COMBO_X.raw.DAMAGE_DATA);

test('2v2 practice has one named player and three identifiable models at the authored starts',async()=>{
  const p=await fixture();assert.equal(p.players.length,4);assert.equal(p.players.filter(a=>a.model).length,3);
  assert.equal(p.players[0].nickname,'Local Tester');
  assert.deepEqual(p.players.map(a=>a.team),[0,0,1,1]);
  assert.deepEqual(p.simulation.state.actors.map(a=>[a.x,a.y,a.z]),[
    [-2082.55,2840,0],[-1952.1,2840,0],[2022.98,2840,0],[1858.11,2840,0]]);
  assert.equal(p.state.phase,'intro');fight(p);
  const own=p.simulation.actor('tester'),initial=own.x,model=p.simulation.actor(p.players[1].id),modelX=model.x;
  for(let i=0;i<20;i++)p.step(1/60,{held:['RIGHT']});
  assert.ok(own.x>initial);assert.ok(Math.abs(model.x-modelX)<.001,'idle authored position allows native float32 conversion');
  assert.equal(p.state.players.length,4);assert.ok(p.state.remaining<420&&p.state.remaining>419);
});

test('practice handles model death, score, respawn and result using the shared lifecycle only',async()=>{
  const p=await fixture();fight(p);const sim=p.simulation,enemyId=p.players[2].id;
  sim.actor(enemyId).hp=1;
  sim.injectHit({attackerId:'tester',targetId:enemyId,damageData:hitData});
  p.step(1/60,{});assert.deepEqual(p.state.score,[1,0]);
  assert.equal(p.state.players.find(a=>a.id===enemyId).deaths,1);
  for(let i=0;i<1200&&!p.state.players.find(a=>a.id===enemyId).alive;i++)p.step(1/60,{});
  assert.equal(p.state.players.find(a=>a.id===enemyId).alive,true);
  assert.equal(sim.actor(enemyId).hp,sim.actor(enemyId).hpMax);
  assert.ok(sim.actor(enemyId).inputLock>0);assert.ok(sim.actor(enemyId).forceInvincible>0);
  for(let kill=0;kill<3;kill++){
    const enemy=sim.actor(enemyId);enemy.hp=0;enemy.forceInvincible=0;enemy.deathComplete=true;
    let value=p.step(1/60,{});
    if(kill<2)for(let i=0;i<1500&&!p.state.players.find(a=>a.id===enemyId).alive;i++)p.step(1/60,{});
  }
  let result=null;for(let i=0;i<100&&!result;i++)result=p.step(1/60,{}).result;
  assert.equal(result.winnerTeam,0);assert.deepEqual(result.score,[4,0]);
  assert.equal(p.step(1/60,{}).result,null,'result is emitted once and never posted to a server');
  p.stop();
});

test('owner hit prediction preserves remote HP, MP and reaction while retaining immediate self attack feedback',async()=>{
  const p=await fixture('tester');fight(p);const sim=p.simulation,enemy=sim.actor(p.players[2].id),own=sim.actor('tester');
  own.mp=0;const before=structuredClone(enemy),beforeOwn=structuredClone(own);
  const result=sim.injectHit({attackerId:own.id,targetId:enemy.id,damageData:hitData});
  assert.equal(result.accepted,true);assert.ok(result.amount>0);
  assert.equal(enemy.hp,before.hp);assert.equal(enemy.mp,before.mp);assert.equal(enemy.state,before.state);
  assert.equal(enemy.stateSerial,before.stateSerial);assert.equal(enemy.vx,before.vx);
  assert.ok(own.mp>beforeOwn.mp);assert.ok(own.awakening.gauge>beforeOwn.awakening.gauge);
  assert.ok(sim.drainEvents().some(e=>e.type==='hit'&&e.targetId===enemy.id));
});

test('the victim owner alone commits HP, receive MP and reaction; other remote fights stay remote',async()=>{
  const p=await fixture('tester');fight(p);const sim=p.simulation,own=sim.actor('tester'),enemy=sim.actor(p.players[2].id);
  own.mp=0;const hp=own.hp,enemyBefore=structuredClone(enemy);
  assert.equal(sim.injectHit({attackerId:enemy.id,targetId:own.id,damageData:hitData}).accepted,true);
  assert.ok(own.hp<hp);assert.ok(own.mp>0);assert.notEqual(own.state,'RSI_WAIT');
  assert.equal(enemy.hp,enemyBefore.hp);assert.equal(enemy.mp,enemyBefore.mp);assert.equal(enemy.hitStop,enemyBefore.hitStop);
  const remoteVictim=sim.actor(p.players[1].id),before=structuredClone(remoteVictim);
  assert.deepEqual(sim.injectHit({attackerId:enemy.id,targetId:remoteVictim.id,damageData:hitData}),{accepted:false,reason:'remote-owners'});
  assert.deepEqual(remoteVictim,before);
});

test('remote resource values survive extrapolation and the offline simulation retains normal two-sided damage',async()=>{
  const online=await fixture('tester');fight(online);const sim=online.simulation,remote=sim.actor(online.players[2].id);
  remote.mp=17;remote.hp=1200;remote.awakening.remaining=.001;remote.core.gauge=100;
  sim.step(1/60,{});assert.equal(remote.hp,1200);assert.equal(remote.mp,17);
  const offline=await fixture();fight(offline);const foe=offline.simulation.actor(offline.players[2].id),hp=foe.hp;
  offline.simulation.injectHit({attackerId:'tester',targetId:foe.id,damageData:hitData});assert.ok(foe.hp<hp);
});
