import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {standupHitPolicy} from '../../packages/combat-core/standup-policy.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const root=resolve(import.meta.dirname,'../..');
const privateAssetRoot=process.env.RF_V61_ASSET_ROOT;
const assets=await loadServerCombatAssets({root,assetRoot:resolve(privateAssetRoot??'artifacts')});
if(privateAssetRoot!==undefined)assert.deepEqual(Object.keys(assets.profiles).sort(),
 ['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'].sort(),
 'Explicit RF_V61_ASSET_ROOT must load all twelve professions; incomplete private assets cannot silently reduce coverage');
const stage=assets.forScene('sander-garpai-rock-pvp'),runtime=await stage.createRuntime();
function make(id){
 const sim=createSimulation({profile:assets.profiles[id],profiles:assets.profiles,preset:assets.presets[id],presets:assets.presets,map:stage.map,
  actors:[{id:'a',professionId:id,team:0,position:[-600,3080,0],lineId:2,loadout:Array(8).fill(null),passives:[],guildPassives:[]},
   {id:'b',professionId:id,team:1,position:[-300,3080,0],lineId:2,loadout:Array(8).fill(null),passives:[],guildPassives:[]}],
  commonBuffs:assets.commonBuffs,...runtime.samplers,nativeGeometry:runtime.native.geometry,nativeSkillValues:runtime.native.skillValues,
  nativeCritical:runtime.native.critical,nativeManaBreak:runtime.native.manaBreak});
 return {sim,a:sim.actor('a'),b:sim.actor('b')};
}
const strike={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.001},REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:.1};
for(const id of Object.keys(assets.profiles))test(`${id}: V61 preserves old world record when normal hit appends0; Mana hit.7 holds reaction then consumes100 once`,()=>{
 const {sim,a,b}=make(id);requestActorStop(a,'world',1,b.id);sim.step(1/60,{}, {snapshot:false});
 const worldRemaining=a.worldStop;assert.ok(worldRemaining>.98);a.mp=250;a.manaBreak.charge=100;
 assert.equal(sim.applyHit(b,a,strike,{kind:'character'}).accepted,true);
 assert.equal(a.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(a.hitStop,Math.fround(.7));
 assert.equal(a.worldStop,0,'original state entry resets scalar caches only');
 assert.deepEqual(a.sourceStopQueues.world,[{remaining:worldRemaining,sourceId:b.id},{remaining:0,sourceId:b.id}],
  'existing record survives; the ordinary received-hit world0 request is the original last-record projection');
 assert.equal(a.manaBreak.charge,100);assert.equal(a.manaBreak.active,true);
 const mp=a.mp;sim.applyHit(b,a,strike,{kind:'character'});assert.equal(a.mp,mp);
 for(let n=0;n<30;n++){sim.step(1/60,{}, {snapshot:false});assert.equal(a.animationTime,0);assert.equal(a.mp,mp);assert.equal(a.worldStop,0,
  'original last zero record masks the earlier positive world record; Mana hit-stop retains the reaction');}
 assert.ok(a.sourceStopQueues.world[0].remaining>0,'the older world record was retained, not deleted or max-folded');
 for(let n=0;n<60&&a.manaBreak.pendingDown;n++)sim.step(1/60,{}, {snapshot:false});
 assert.equal(a.manaBreak.pendingDown,undefined);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');assert.ok(a.animationTime>0);
 const packet=encodeOwnedState(sim,a.id,{frameSeq:1});validateOwnedState(packet);
 assert.equal(sim.state.events.filter(e=>e.type==='manaBreakConsumed').length,1);
});
for(const id of ['RF','BM','VC'])for(const side of ['FRONT','BACK'])for(const direction of [-1,1])test(`${id}/${side}/${direction}: original roll has continuous displacement and protection`,()=>{
 const {sim,a}=make(id);sim.enter(a,'RSI_DAMAGE_DOWN_'+side,'fixture');a.animationTime=.7;
 const key=direction===1?'RIGHT':'LEFT',points=[];
 for(let n=0;n<130;n++){
  sim.step(1/60,{a:{held:[key],pressed:n===0?[key]:[]}},{snapshot:false});
  if(a.state.includes('STANDUP_ROLLING')){points.push(a.x);assert.equal(a.invincible,true);}
  else if(points.length)break;
 }
 assert.ok(points.length>15);assert.ok(Math.abs(points.at(-1)-points[0])>400);
 assert.ok(points.every((x,i)=>i===0||Math.abs(x-points[i-1])<100),'no endpoint teleport');
});
for(const id of ['LP','MM','DE'])test(`${id}: sourced standup-X effect is non-down; unrelated and stale effects retain their own data`,()=>{
 const actor={professionId:id,standupAttackNoDown:true,state:'RSI_STANDUP_ATTACK_FRONT_NO_DOWN',stateSerial:12};
 const data={REACT_TYPE:5,FORCE_DOWN:-37};
 const origin={kind:'effect',name:'DamageEffect_AN_StandUp_Attack',ownerStateSerial:12};
 assert.deepEqual(standupHitPolicy(actor,data,origin),{noDown:true,data:{...data,REACT_TYPE:2,FORCE_DOWN:0,DECREASE_FORCE_DOWN:0}});
 assert.equal(standupHitPolicy(actor,data,{...origin,ownerStateSerial:11}).noDown,false);
 assert.equal(standupHitPolicy(actor,data,{...origin,name:'unrelated'}).noDown,false);
});
test('zero-damage DT_BUFF contact bypasses numeric damage formulas without inventing an attack channel',()=>{
 const {sim,a,b}=make('LP'),hp=b.hp;
 const result=sim.applyHit(a,b,{...strike,DAMAGE_TYPE:6,NO_DAMAGE:1,DAMAGE:{},REACT_TYPE:2},{kind:'effect'});
 assert.equal(result.accepted,true);assert.equal(result.amount,0);assert.equal(b.hp,hp);
 assert.equal(sim.state.unsupported.some(row=>row.id?.startsWith('pvp-damage:')),false);
});
