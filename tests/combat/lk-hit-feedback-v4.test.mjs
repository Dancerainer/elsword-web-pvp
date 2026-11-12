import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {encodeOwnedState,applyOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const profiles={RF:read('packages/combat-core/rf-profile.json'),LK:read('packages/combat-core/lk-profile.json'),VC:read('packages/combat-core/vc-profile.json'),BM:read('packages/combat-core/bm-profile.json')};
const map={sceneId:'counter-native-state-fixture',lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}]};
const native=await createNativeRuntime({manifest:read('artifacts/native/manifest.json'),map,loadBinary:p=>readFileSync(new URL('../../artifacts/native/'+p,import.meta.url))});
const ordinary={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,CAN_REVENGE:1,BACK_SPEED_X:400,STOP_TIME_ATT:.08};
const stun=profiles.RF.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
const presets={RF:read('config/rf-preset.json'),LK:read('config/lk-preset.json'),VC:read('config/vc-preset.json'),BM:read('config/bm-preset.json')};
function mixed(profession='RF',facing=-1){
 return createSimulation({profile:profiles.RF,profiles,preset:{...presets.RF,guildPassives:[],passives:[],loadout:Array(8).fill(null)},
  presets:Object.fromEntries(Object.entries(presets).map(([id,p])=>[id,{...p,guildPassives:[],loadout:Array(8).fill(null)}])),map,nativeSkillValues:native.skillValues,
  actors:[{id:'attacker',professionId:profession,team:0,x:facing*100,y:0,facing:-facing},
   {id:'lk',professionId:'LK',team:1,x:0,y:0,facing},
   {id:'source',professionId:'RF',team:1,x:1500,y:0,facing:1}],seed:2016});
}
for(const profession of ['RF','LK','VC'])test(`received-hit ${profession}: immediate stun cleanup preserves unrelated buffs and frees input`,()=>{
 const s=mixed(profession),a=s.actor('attacker'),b=s.actor('lk');s.rng=()=>0;
 s.grantBuff(s.actor('source'),a,stun);const stunId=a.buffs[0].templateId;
 s.grantBuff(s.actor('source'),a,profiles.RF.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.BUFF_FACTOR,1);
 const unrelated=a.buffs.filter(v=>v.templateId!==stunId).map(v=>v.templateId);
 assert.equal(a.buffControls.inputBlock,true);assert.equal(a.animationName,'Fatal');
 s.injectHit({attackerId:'lk',targetId:'attacker',damageData:ordinary});
 assert.ok(!a.buffs.some(v=>v.templateId===stunId));assert.equal(a.buffControls.inputBlock,false);
 assert.deepEqual(a.buffs.map(v=>v.templateId),unrelated);
 assert.ok(s.state.events.some(e=>e.type==='buffFinished'&&e.actorId===a.id&&e.reason==='received-hit-stun-cure'));
 assert.ok(s.state.effects.filter(e=>e.ownerId===a.id&&e.buffTemplateId===stunId).every(e=>e.dead));
});
test('rejected hits retain stun; the next real hit removes it before applying a new stun factor',()=>{
 const s=mixed(),a=s.actor('attacker');s.rng=()=>0;s.grantBuff(a,a,stun);
 const id=a.buffs[0].templateId;a.invincible=true;
 assert.equal(s.injectHit({attackerId:'lk',targetId:'attacker',damageData:ordinary}).accepted,false);assert.equal(a.buffControls.inputBlock,true);
 a.invincible=false;s.injectHit({attackerId:'lk',targetId:'attacker',damageData:{...ordinary,BUFF_FACTOR:stun}});
 assert.equal(a.buffs.filter(v=>v.templateId===id).length,1);assert.equal(a.buffControls.inputBlock,true);
 assert.equal(s.state.events.filter(e=>e.type==='buffFinished'&&e.reason==='received-hit-stun-cure').length,1);
});
for(const profession of ['RF','LK','VC','BM'])for(const facing of [-1,1])test(`Counter ${profession}/${facing}: own original surprised pose, stopped velocity, recovery and remote reconstruction`,()=>{
 const s=mixed(profession,facing),a=s.actor('attacker'),b=s.actor('lk');
 s.configureLoadout([{skillId:21206},...Array(7).fill(null)],'lk');s.step(1/60,{lk:{pressed:['A']}});
 b.animationTime=.1;b.invincible=false;a.vx=123;a.vy=12;a.animationPlaybackSpeed=1.3;
 const hp=a.hp,result=s.injectHit({attackerId:a.id,targetId:b.id,damageData:ordinary});
 assert.equal(result.countered,true);assert.equal(a.hp,hp);assert.equal(a.state,'RSI_DAMAGE_REVENGE');
 assert.equal(a.animationName,'DamageRevenge');assert.equal(a.vx,0);assert.equal(a.vy,0);
 assert.equal(a.hitStop,0,'append leaves the current STOP cache untouched until the actor update');
 assert.deepEqual(a.sourceStopQueues?.hit.at(-1),{remaining:Math.fround(.08),sourceId:null});
 assert.equal(a.animationTargetSpeed,1);assert.ok(a.animationPlaybackSpeed<=1);
 const packet=encodeOwnedState(s,a.id);validateOwnedReferences(packet,a,profiles[profession],map);
 const receiver=mixed(profession,facing);applyOwnedState(receiver,a.id,packet);assert.equal(receiver.actor(a.id).animationName,'DamageRevenge');
 // Victim leaves the space; no later counter strike can mask the recovery.
 b.x=1000;b.invincible=true;
 const stoppedAnimation=a.animationTime;s.step(1/60,{});
 assert.equal(a.hitStop,Math.fround(Math.fround(.08)-Math.fround(1/60)));
 assert.equal(a.animationTime,stoppedAnimation,'the next update caches/decrements the full packet and remains stopped');
 for(let i=1;i<100;i++)s.step(1/60,{});
 assert.equal(a.state,'RSI_WAIT');assert.ok(!s.state.unsupported.some(d=>/revenge/i.test(d.id??'')));
});
test('reflected effect does not force its distant owner into a melee surprised pose',()=>{
 const s=mixed(),a=s.actor('attacker'),b=s.actor('lk');s.enter(b,'ESSI_REVENGE_WAIT','fixture');b.animationTime=.1;b.invincible=false;
 s.applyParticipantHit(a,b,ordinary,{kind:'effect',id:99,attackPosition:[-30,0,0]});
 assert.notEqual(a.state,'RSI_DAMAGE_REVENGE');
});
for(const facing of [-1,1])test(`destruction rage ${facing}: target angry-wind native helper actually launches a nearby enemy once`,async()=>{
 const f=await lkCommandFixture({facing,gap:85}),a=f.actor,b=f.target,s=f.sim;s.rng=()=>.99;s.prepareWayOfSword(a.id,-2);s.drainEvents();
 s.injectHit({attackerId:b.id,targetId:a.id,damageData:ordinary});
 const wind=s.state.effects.find(e=>e.name==='ELSWORD_ANGRY_WIND');assert.ok(wind,'damage-effect declaration, not an effect-template lookup');
 assert.deepEqual(wind.birthAnchor.position,[a.x,a.y+80,a.z]);
 let launched=false;const hits=[];
 for(let i=0;i<30;i++){s.step(1/60,{});launched||=b.vy>0&&!b.grounded;hits.push(...s.drainEvents().filter(e=>e.type==='hit'&&e.origin.id===wind.id));}
 assert.ok(launched,'native attack box and RT_FLY must launch the enemy');assert.equal(hits.length,1);
 assert.equal(hits[0].data.REACT_TYPE,5);assert.equal(hits[0].data.FORCE_FLY,1);assert.equal(hits[0].data.BACK_SPEED_Y,1000);
 assert.equal(a.superArmor,true);assert.ok(a.destructionRageRemaining>5);
});
for(const facing of [-1,1])test(`Kick ${facing}: exact left-foot sphere and original close rear overlap; distant rear misses`,async()=>{
 for(const offset of [-120,-60,140,400]){
  const f=await lkCommandFixture({facing,gap:offset,preset:{guildPassives:[],attributes:{animationSpeedMultiplier:1}}});
  f.sim.configureLoadout([{skillId:21219},...Array(7).fill(null)],'lk');f.sim.drainEvents();let hits=0,windows=0;
  for(let i=0;i<90;i++){
   f.sim.step(1/60,{lk:i===0?{pressed:['A']}:{}},{snapshot:false});const a=f.actor;
   if(a.state==='ESSI_SI_A_ES_KICK'&&a.animationTime>.1&&a.animationTime<.22){
    const shapes=f.sim.collisionSampler(a,{raw:f.profile.states[a.state].raw});assert.equal(shapes.length,1);
    assert.equal(shapes[0].source.helper,'ATTACK_SPHERE2_Lfoot');assert.ok(Math.abs(shapes[0].radius-38.971138)<.001);windows++;
   }
   hits+=f.sim.drainEvents().filter(e=>e.type==='hit'&&e.actorId==='lk').length;
  }
  assert.ok(windows>0);assert.equal(hits,[-60,140].includes(offset)?1:0,'original geometry at offset '+offset);
 }
});
