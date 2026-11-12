/** Current authenticated-owner server boundary. These checks exercise the
 * production room driver; caller identity is supplied by the authenticated
 * online service, not by any field of the owner report. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const players=['attacker','ally','victim','other'].map((id,i)=>({id,username:id,team:i<2?0:1,loadout:Array(8).fill(null)}));
const map={sceneId:'v55-victim-authority',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
  starts:players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*1000,0,0],lineId:0,facingRight:true}))};
function fixture(t){
  const sim=createSimulation({profile,map,actors:players.map((p,i)=>({...p,position:[i*1000,0,0]})),seed:201655,
    versions:{referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'}});
  sim.step=()=>{throw Error('the ownership room must not replay combat');};
  const pvp=new PvpMatch({players,map,seed:201655,versions:sim.versions});
  const driver=createLocalOwnerBattleDriver({match:{id:'v55-victim-authority',players},simulation:sim,pvp,manual:true,clock:()=>0,emit:()=>{},finish:()=>{}});
  t.after(()=>driver.stop());for(const player of players)driver.ready(player.id);driver.tick(10);
  assert.equal(driver.snapshot().pvp.phase,'fight');
  const report=(id,frameSeq)=>encodeOwnedState(sim,id,{epoch:driver.snapshot().ownership.actors[id].epoch,frameSeq});
  const submit=(id,owner)=>driver.submitInput(id,{frames:[{held:[],frameSeq:owner.frameSeq}],owner});
  return {sim,pvp,driver,report,submit};
}

test('an attacker cannot name another victim in a hit receipt or replace its authenticated actor identity',t=>{
  const f=fixture(t),before=f.sim.snapshot(),report=f.report('attacker',1);
  report.hits=[{id:1,attackerId:'attacker',targetId:'victim',damage:50000}];
  assert.throws(()=>f.submit('attacker',report),/invalid-owner-hit/);
  assert.deepEqual(f.sim.snapshot(),before,'a rejected forged target has no partial combat writes');
  const forged=f.report('attacker',2);forged.actor.id='victim';forged.actor.hp=0;
  assert.throws(()=>f.submit('attacker',forged),/invalid-owner-state/);
  assert.deepEqual(f.sim.snapshot(),before);
});

test('an attacker report can change only its own HP; only the victim report can commit victim HP',t=>{
  const f=fixture(t),victimBefore=structuredClone(f.sim.actor('victim')),own=f.report('attacker',1);
  own.actor.hp=0;own.actor.deathComplete=true;
  own.hits=[{id:1,attackerId:'victim',damage:50000}];
  assert.equal(f.submit('attacker',own).accepted,true);
  assert.equal(f.sim.actor('attacker').hp,0);
  assert.deepEqual(f.sim.actor('victim'),victimBefore,'a damage amount in another owner report cannot deduct this victim HP');
  f.driver.tick(.1);
  assert.equal(f.sim.actor('victim').hp,victimBefore.hp);
  const current=f.report('victim',1);current.actor.hp-=100;
  current.hits=[{id:2,attackerId:'ally',damage:100}];
  assert.equal(f.submit('victim',current).accepted,true);
  assert.equal(f.sim.actor('victim').hp,victimBefore.hp-100);
  assert.equal(f.sim.actor('attacker').hp,0);
});
