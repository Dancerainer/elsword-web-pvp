/** Current production encoder corpus, not original-client captures. Inputs use
 * the RF simulation, actual effect birth and authored twelve-profession Buffs.
 * Synthetic long filler and repeated fabricated actors are deliberately absent. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {encodeOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {createOwnerBuffSender} from '../../packages/online/owner-buff-sync.mjs';
import {authoredBuffFixtures} from './network-buff-codec-v37.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

export async function networkCodecCorpus(){
  const raw=readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)),profile=JSON.parse(raw);
  const map={sceneId:'v59-codec-input',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
  const actors=Array.from({length:4},(_,index)=>({id:`player-${index+1}-v59`,team:index%2,position:[index*2000,0,0],lineId:0,loadout:Array(8).fill(null)}));
  const sim=createSimulation({profile,map,networkOwnerId:actors[0].id,seed:201659,preset:{passives:[],guildPassives:[]},actors});
  const producer=createCombatPlaybackProducer({version:1}),sender=createOwnerPoseDelta();
  const matchId='room-201659-codec-current',sourceId=actors[0].id,rows=[];
  const add=(name,kind,value)=>{rows.push({name,kind,value,jsonSha256:sha(JSON.stringify(value))});};
  function report(frame){const value=encodeOwnedState(sim,sourceId,{epoch:1,frameSeq:frame});value.actor.sourceStatusClock={version:1,revision:1,frameSeq:frame};return validateOwnedState(value);}
  function capture(frame,held){
    const current=report(frame),action=producer.capture(sim,sourceId,{epoch:1,frameSeq:frame,held,report:current});
    add(`motion-${frame}`,'movement',{matchId,sequence:frame,motionVersion:1,motionMaxVersion:2,motionOnly:true,motion:encodeOwnedMotion(current,{held,includeReaction:true})});
    add(`pose-${frame}`,'pose',{matchId,sequence:frame,packet:{frameSeq:frame,held,pressed:[],released:[]},poseDelta:2,buffSyncVersion:2,motionVersion:1,motionMaxVersion:2,
      ownerDelta:sender.encode(current,{acknowledgedEpoch:1,acknowledgedFrameSeq:frame===1?-1:frame===31?1:31,version:2}),controlSequence:1});
    if(action)add(`action-${frame}`,'action',{v:1,matchId,type:'actions',sequence:frame,report:{protocol:current.protocol,epoch:current.epoch,frameSeq:current.frameSeq,actor:current.actor,effects:current.effects,hits:[],actions:[action]}});
    return current;
  }
  capture(1,[]);
  for(let frame=2;frame<=31;frame++)sim.step(1/60,{[sourceId]:{held:['RIGHT'],pressed:frame===2?['RIGHT']:[],released:[]}},{snapshot:false});
  capture(31,['RIGHT']);
  sim.createEffect(sim.actor(sourceId),{NAME:'DAMAGE_EFFECT_POWER_ASSAULT'},{clock:'custom',start:0});
  capture(32,['RIGHT']);
  const fixture=await authoredBuffFixtures();
  for(const {id,buff}of fixture.rows){
    const status=encodeOwnedStatus({...report(33),actor:{...report(33).actor,buffs:[buff]}}),buffSender=createOwnerBuffSender();buffSender.capture(status);
    add(`buff-${id}`,'buff',{type:'buff-sync',v:2,matchId,ownerId:sourceId,requesterId:actors[1].id,kind:'snapshot',snapshot:buffSender.snapshot()});
  }
  // Four actual downstream event envelopes, individually encoded. The byte
  // report totals this group; production does not invent an aggregate packet.
  for(const actor of actors)add(`four-player-${actor.id}`,'multiplayer',{type:'event',event:'owned-state',data:{matchId,playerId:actor.id,report:encodeOwnedState(sim,actor.id,{epoch:1,frameSeq:32})}});
  return {source:{kind:'current-Web-production-encoder',profileSha256:sha(raw),wasmSha256:fixture.wasm.sha256,seed:201659,
    limitation:'RF headless movement/action plus twelve authored Buffs; no GPU, original runtime, native RTC, WAN, or broad action frequency claim'},rows};
}
