/** Real core contact entry + original MM declaration. The deliberately broad
 * sphere isolates repeat/contact policy; it does not claim a native pose.
 * Invincible contact memory is the Web adapter around the recovered callback,
 * whose original owner +328 is observed before the reaction-result gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {startAddShootingChaser,CHASER_ATTACKER} from '../../packages/combat-core/add-analysis-skills.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const map={sceneId:'analysis-contact-policy-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(networkOwnerId=null){
 const sim=createSimulation({profile,map,networkOwnerId,preset:{passives:[],guildPassives:[]},actors:[
  {id:'add',team:0,position:[0,0,0],lineId:0},{id:'enemy',team:1,position:[200,0,0],lineId:0}],
  effectAnchorSampler:(_e,a)=>({position:[a.x,a.y+80,a.z],facing:a.facing,rotation:[0,0,0]})});
 const owner=sim.actor('add'),target=sim.actor('enemy');owner.skillId=29018;
 assert.equal(startAddShootingChaser(sim,owner),true);
 const e=sim.state.effects.find(e=>e.name===CHASER_ATTACKER),data=structuredClone(e.damage.DAMAGE_DATA);
 assert.equal(data.NO_DAMAGE,1);assert.equal(data.RE_ATTACK,1);assert.equal(data.HIT_GAP,.1);
 const shape={kind:'sphere',center:[target.x,target.y+100,target.z],radius:200};
 const origin={kind:'effect',id:e.id,skillId:29018,powerMultiplier:e.powerMultiplier};
 return {sim,owner,target,e,data,count:()=>owner.sourceAddNative[0].records[0]?.count??0,
  contact:()=>sim.checkHits(owner,[shape],data,e.hits,origin),
  miss:()=>sim.checkHits(owner,[],data,e.hits,origin)};
}

for(const protection of ['none','invincible','force'])test(`actual Chaser ${protection} contact records once per original 0.1s gap before reaction`,()=>{
 const f=fixture();
 if(protection==='invincible')f.target.invincible=true;
 if(protection==='force')f.target.forceInvincible=.5;
 const hp=f.target.hp,state=f.target.state;
 f.miss();assert.equal(f.count(),0,'no geometric impact cannot record a target');
 f.contact();assert.equal(f.count(),1);assert.equal(f.target.hp,hp,'the original attacker is NO_DAMAGE');
 assert.equal(f.e.hits.enemy,0);assert.equal(f.e.hitGaps.enemy,.1);
 for(let repeat=0;repeat<3;repeat++){f.contact();assert.equal(f.count(),1,'same-callback overlaps cannot inflate source contact count');}
 // Original own-list TTL consumes carrier received delta, independently of
 // state.time. An absolute wall-clock edit must not expire that list.
 f.sim.state.time=.099;f.contact();assert.equal(f.count(),1);
 f.sim.state.time=.1;f.sim.tickEffects(Math.fround(.1));f.contact();assert.equal(f.count(),2,'one actual carrier delta exhausts the original float0.1 gap');
 if(protection!=='none')assert.equal(f.target.state,state,'protection suppresses the ordinary reaction after the callback');
});

test('a receiving defender cannot author the remote Chaser controller contacts',()=>{
 const f=fixture('enemy');f.contact();f.sim.state.time=.1;f.sim.tickEffects(Math.fround(.1));f.contact();
 assert.equal(f.count(),0,'only the original effect owner records native callback targets');
});
