/** Actual credited resource and actor anchors are production facts. Source
 * equations come from LP_STASIS_FIELD_2016 / add-fantasy-tracer-source-v1;
 * the requested blue PicChar display is a V61 project presentation rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beginAddFormation,initializeAddSystems} from '../../packages/combat-core/add-systems.mjs';
import {tickAddRecasts} from '../../packages/combat-core/add-recasts.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
const actor=mp=>({id:'lp',professionId:'LP',hp:1000,hpMax:1000,mp,mpMax:300,x:12,y:345,z:-6,
 passivePolicy:{skillLevels:{29404:3}},equipmentAttributes:{},awakening:{},loadout:[{skillId:29007}]});
for(const mp of [0,299,300])test(`Fantasy Tracer event reports credited MP at actor+50, starting MP ${mp}`,()=>{
 const a=actor(mp),events=[];initializeAddSystems(a,{preset:{initialDp:8000}});
 assert.equal(beginAddFormation(a,{profile,emit:(type,id,data)=>events.push({type,id,...data})}),true);
 const e=events.find(e=>e.type==='addFantasyTracerMpRecovered');assert.ok(e);
 assert.deepEqual(e.position,[12,395,-6]);assert.equal(e.resource,'MP');assert.equal(e.amount,a.mp-mp);
 const originalEntryCharge=profile.components.USE_DP_BY_FORMATION_MODE;
 assert.equal(e.declaredAmount,Math.fround(originalEntryCharge*.5/20));
 assert.equal(e.amount,Math.min(300-mp,e.declaredAmount));
});
for(const mp of [0,299,300])test(`Stasis timeout reports the actual credited MP once at actor+50, starting MP ${mp}`,()=>{
 const a=actor(mp),events=[];a.sourceAddCombat={stasis:{remaining:.01,hitValue:0,damageValue:0}};
 const sim={state:{effects:[]},profileFor:()=>profile,skillAvailability:()=>({mpCost:300}),
  spawnSet(){},emit:(type,id,data)=>events.push({type,id,...data})};
 tickAddRecasts(sim,a,.02);tickAddRecasts(sim,a,.02);
 const rows=events.filter(e=>e.type==='addStasisMpRecovered');assert.equal(rows.length,1);const e=rows[0];
 assert.deepEqual(e.position,[12,395,-6]);assert.equal(e.resource,'MP');
 assert.equal(e.declaredAmount,Math.fround(300*.3333333432674408));
 assert.equal(e.amount,Math.min(300-mp,e.declaredAmount));assert.equal(e.amount,a.mp-mp);
 assert.equal(a.sourceAddCombat.stasis,null);
});
test('Stasis death or unavailable cost clears storage without inventing recovery text',()=>{
 for(const [hp,cost]of [[0,300],[1000,undefined]]){
  const a=actor(0),events=[];a.hp=hp;a.sourceAddCombat={stasis:{remaining:.01,hitValue:0,damageValue:0}};
  const sim={state:{effects:[]},profileFor:()=>profile,skillAvailability:()=>({mpCost:cost}),spawnSet(){},emit:(type)=>events.push(type)};
  tickAddRecasts(sim,a,.02);assert.equal(a.mp,0);assert.equal(events.includes('addStasisMpRecovered'),false);
 }
});
