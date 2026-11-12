import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {actionAnimationSpeed,isHurtAnimation} from '../../packages/combat-core/action-animation-speed.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const ids=['RF','LK','VC','RS','BM','IS'];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
for(const id of ids){
 const profile=read(`packages/combat-core/${id.toLowerCase()}-profile.json`);
 for(const state of Object.keys(profile.states).filter(s=>isHurtAnimation(profile.states[s],s))){
  test(`${id} ${state}: only final positive speed bonus is capped`,()=>{
   const def=profile.states[state],base=def.raw.ANIM_SPEED??1;
   for(const [speed,want]of [[1.3,1],[1,1],[.8,.8],[.65,.65],[.2,.2]]){
    close(actionAnimationSpeed({state,stats:{animationSpeedMultiplier:speed}},def),base*want);
   }
  });
 }
 test(`${id}: direct received-hit transition cannot inherit the prior boosted clock`,()=>{
  const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LT_NORMAL'}]},preset:{attributes:{animationSpeedMultiplier:1.3},passives:[],guildPassives:[]},actors:[{id:'a',x:0,y:0}]});
  const a=sim.actor('a');a.animationPlaybackSpeed=1.3;
  sim.enter(a,'RSI_DAMAGE_SMALL_FRONT','hit-reaction',{directChange:true});
  close(a.animationTargetSpeed,1);assert.ok(a.animationPlaybackSpeed<=1);
  const time=a.animationTime;sim.advanceAnimation(a,profile.states[a.state],.05);assert.ok(a.animationTime-time<=.05+1e-10);
  a.stats.animationSpeedMultiplier=.65;sim.advanceAnimation(a,profile.states[a.state],.05);close(a.animationTargetSpeed,.65);assert.ok(a.animationPlaybackSpeed<=.65);
  sim.enter(a,'RSI_COMBO_Z');close(sim.animationSpeed(a),(profile.states[a.state].raw.ANIM_SPEED??1)*a.stats.animationSpeedMultiplier);
 });
}
test('existing Buff composition is preserved: 30% and -50% yield65%, capped only above100%',()=>{
 const a={state:'RSI_DAMAGE_SMALL_FRONT',stats:{animationSpeedMultiplier:1.3},buffBaseStats:{animationSpeedMultiplier:1.3},buffs:[{behaviors:[{kind:'stat',stat:'animationSpeedMultiplier',changeType:3,value:.5}]}]};
 synchronizeBuffStats(a);close(a.stats.animationSpeedMultiplier,.65);close(actionAnimationSpeed(a,{raw:{}}),.65);
 a.buffs=[];synchronizeBuffStats(a);close(actionAnimationSpeed(a,{raw:{}}),1);
 a.state='RSI_DAMAGE_STANDUP_FRONT';close(actionAnimationSpeed(a,{raw:{}}),1.3);
 a.state='RSI_DAMAGE_REVENGE';close(actionAnimationSpeed(a,{raw:{}}),1);
 a.state='ESSI_REVENGE_ATTACK';close(actionAnimationSpeed(a,{raw:{}}),1.3);
 a.state='RSI_COMBO_Z';close(actionAnimationSpeed(a,{raw:{ANIM_SPEED:1.2}}),1.56);
});
