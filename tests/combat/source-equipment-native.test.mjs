/** Current 80/+9 + 80/+9 preset with real map, poses and native modules.
 * Web integration evidence; no original-client measured trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:root+'/artifacts'});
async function make(profession){
 const {native:n,samplers}=await assets.createRuntime();
 return createSimulation({profile:assets.profiles[profession],profiles:assets.profiles,
  preset:assets.presets[profession],presets:assets.presets,map:assets.map,seed:2016,
  actors:[{id:'attacker',professionId:profession,team:0,position:[0,3080,0],lineId:2,facing:1,passives:[],guildPassives:[]},
   {id:'target',professionId:profession==='RF'?'LK':'RF',team:1,position:[80,3080,0],lineId:2,facing:-1,passives:[],guildPassives:[]}],
  ...samplers,nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
  nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,commonBuffs:assets.commonBuffs});
}
for(const profession of ['RF','LK','VC'])test(`${profession} current source gear executes native contact and deterministic JSON continuation with equipment options`,async()=>{
 const a=await make(profession),b=await make(profession);
 // v26 user action-speed options, independent of unchanged source gear and
 // movement/jump attributes. These are current preset policy, not 2016 values.
 assert.equal(a.actor('attacker').stats.animationSpeedMultiplier,Math.fround({RF:1.37,LK:1.37,VC:1.33}[profession]));
 assert.equal(a.actor('attacker').mpMax,{RF:330,LK:300,VC:330}[profession]);
 const events=[];
 for(let frame=0;frame<90;frame++){
  const input=frame===0?{attacker:{pressed:['Z'],held:['Z']}}:{};
  a.step(1/60,input,{snapshot:false});b.step(1/60,input,{snapshot:false});
  const actual=a.drainEvents();assert.deepEqual(actual,b.drainEvents());events.push(...actual);
  if(frame===45)b.restore(JSON.parse(JSON.stringify(a.snapshot())));
 }
 const hits=events.filter(e=>e.type==='hit'&&e.actorId==='attacker');
 assert.ok(hits.length>0,'real source Z and posed native collisions must produce contact');
 assert.ok(hits.every(e=>e.amount>0));
 assert.equal(a.actor('target').hp,a.actor('target').hpMax-hits.reduce((sum,e)=>sum+e.amount,0));
 assert.deepEqual(a.snapshot(),b.snapshot());
});
