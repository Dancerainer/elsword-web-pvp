import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapLoadingBudget} from '../../packages/online/map-loading-budget.mjs';
import {createLocalOwnerBattleDriver} from '../../apps/server/local-owner-driver.mjs';
import {createVerifiedBattleDriver} from '../../apps/server/battle-driver.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PvpMatch} from '../../packages/pvp/index.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));

test('cold roster CPU preparation reserves at least120 seconds and shared map transfer is bounded by180 seconds',()=>{
  assert.equal(mapLoadingBudget(9_257_648,2),120);assert.equal(mapLoadingBudget(9_257_648,4),150);assert.equal(mapLoadingBudget(9_257_648,6),179);
  assert.equal(mapLoadingBudget(0,6),120);assert.equal(mapLoadingBudget(100_000_000,6),180);
  assert.equal(mapLoadingBudget(9_257_648,6,{outboundBitsPerSecond:10_000_000}),135);
  assert.equal(mapLoadingBudget(9_257_648,2,{minimumSeconds:30,setupSeconds:30}),60,'explicit old CPU budget retains transfer formula');
  for(const [bytes,count] of [[-1,4],[NaN,4],[1.2,4],[10,0],[10,7]])assert.throws(()=>mapLoadingBudget(bytes,count),/invalid-map-loading-budget/);
});
test('both room drivers preserve a healthy unready player beyond thirty seconds and enforce the configured extended deadline once',t=>{
  for(const create of [createLocalOwnerBattleDriver,createVerifiedBattleDriver]){
    const players=Array.from({length:4},(_,i)=>({id:String(i),username:String(i),team:i<2?0:1}));
    const map={sceneId:'loading-budget-simulation-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}],
      spawns:players.map((p,i)=>({index:i,kind:'SetTeamStartPos',teamFlag:p.team===0,position:[i*1000,0,0],lineId:0,facingRight:true}))};
    const sim=createSimulation({profile,map,actors:players.map((p,i)=>({...p,position:[i*1000,0,0]})),versions:{referenceVersion:'loading-fixture',presetVersion:'loading-fixture',programVersion:'loading-fixture'}});
    const pvp=new PvpMatch({players,map,seed:1,versions:sim.versions}),events=[];
    const driver=create({match:{id:'extended-ready-fixture',players,loadingTimeoutSeconds:90},simulation:sim,pvp,manual:true,clock:()=>0,emit:(type,data)=>events.push({type,data}),finish(){}});
    t.after(()=>driver.stop());for(const player of players.slice(0,3))driver.ready(player.id);
    for(let second=0;second<60;second++)driver.tick(1);assert.equal(events.some(event=>event.type==='player-timeout'),false);
    assert.notEqual(sim.actor('3').pvpDisconnected,true);for(let second=60;second<90;second++)driver.tick(1);
    assert.equal(events.filter(event=>event.type==='player-timeout').length,1);assert.equal(sim.actor('3').pvpDisconnected,true);
    driver.tick(.1);assert.equal(events.filter(event=>event.type==='player-timeout').length,1);
  }
});
