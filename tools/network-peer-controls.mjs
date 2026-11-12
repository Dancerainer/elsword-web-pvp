/** Test-peer input scheduling only. Gameplay availability, costs and cooldowns
 * are always read from the actual simulation; this tool never grants vitals. */
import {watch} from 'node:fs';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {SKILL_SLOT_KEYS} from '../packages/combat-core/skill-availability.mjs';

export function createPeerInputController({mode='1v1',skills=mode!=='1v1',skillGapSeconds=1.2}={}){
  let previousHeld=[],cursor=0,nextSkillAt=0;
  return {
    next(simulation,localId,{phase,elapsed}){
      const actor=simulation.actor(localId),others=simulation.state.actors.filter(row=>row.id!==localId&&!row.pvpDisconnected);
      const enemy=mode==='1v1'?others[0]:others.filter(row=>row.team!==actor.team&&!row.pvpDead&&row.hp>0)
        .sort((a,b)=>Math.hypot(a.x-actor.x,a.y-actor.y)-Math.hypot(b.x-actor.x,b.y-actor.y))[0];
      let held=[],skillAttempt=null;
      if(phase==='fight'&&enemy){
        const distance=enemy.x-actor.x;
        if(skills&&elapsed>=nextSkillAt&&Math.abs(distance)<=350&&Math.abs(enemy.y-actor.y)<=200){
          for(let offset=0;offset<SKILL_SLOT_KEYS.length;offset++){
            const slot=(cursor+offset)%SKILL_SLOT_KEYS.length;if(!actor.loadout?.[slot])continue;
            const availability=simulation.skillAvailability(localId,slot);if(!availability.available)continue;
            held=[SKILL_SLOT_KEYS[slot]];skillAttempt={slot,key:held[0],skillId:availability.skillId??actor.loadout[slot].skillId};
            cursor=(slot+1)%SKILL_SLOT_KEYS.length;nextSkillAt=elapsed+skillGapSeconds;break;
          }
        }
        if(!held.length){
          if(Math.abs(distance)>120)held=[distance>0?'RIGHT':'LEFT'];
          else if(elapsed%1.2<.45)held=['Z'];
          // Multiplayer test navigation uses legal jump/drop inputs when the
          // closest enemy is on another platform. This is bot policy, not a
          // claim about original-client movement or automatic skill range.
          if(mode!=='1v1'&&actor.grounded&&elapsed%1.5<.15){
            if(enemy.y-actor.y>100)held=[...held.filter(key=>key!=='Z'),'UP'];
            else if(actor.y-enemy.y>100)held=[...held.filter(key=>key!=='Z'),'DOWN'];
          }
        }
      }
      const input={held,pressed:held.filter(key=>!previousHeld.includes(key)),released:previousHeld.filter(key=>!held.includes(key)),sampledDevice:false};
      previousHeld=held;return {input,skillAttempt,enemyId:enemy?.id??null};
    },
  };
}

/** Await a local launch file with fs.watch. Each wait has one bounded timeout;
 * it does not poll the file at simulation cadence while the browser loads. */
export async function createFightFileGate(file){
  if(!file)return {get open(){return true;},wait:async()=>true,close(){}};
  let open=false,closed=false,watcher,release;
  const released=new Promise(resolve=>{release=resolve;});
  async function check(){
    if(open||closed)return;
    try{await access(file);if(closed)return;open=true;watcher?.close();release(true);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await check();
  if(!open){watcher=watch(path.dirname(file),()=>{void check().catch(()=>{});});await check();}
  return {
    get open(){return open;},
    async wait(timeoutMs=5000){
      if(open||closed)return open;let timer;
      try{return await Promise.race([released,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
      finally{clearTimeout(timer);}
    },
    close(){closed=true;watcher?.close();release(open);},
  };
}
