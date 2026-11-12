import rfSounds from '../../contracts/rf-pose-sounds-v25.json' with {type:'json'};
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';
/** Presentation poses run outside Combat.step during intro/result. Consume
 * their target SOUND_PLAY rows on the displayed pose clock, once per edge;
 * death sounds continue through the existing combat animation clock. */
export function createPoseAudio({profileFor,localActorId,play,random=Math.random}){
  const clocks=new Map(),played=[];
  return {
    step(actor,time){
      const pose=actor.pvpPresentation;if(!pose){clocks.delete(actor.id);return;}
      // User preference: intro, victory and defeat cues belong to the local
      // character. Combat voices keep their separate original audience rules.
      if(actor.id!==localActorId()){clocks.delete(actor.id);return;}
      const raw=profileFor(actor).states[pose.state]?.raw??rfSounds.states[pose.state];if(!raw)return;
      let clock=clocks.get(actor.id);
      // A result receipt can rebase the display clock after its state snapshot.
      // Seeking within the same pose must not replay its character voice.
      if(!clock||clock.state!==pose.state)clock={state:pose.state,time:0,fired:new Set()};
      const after=time*(raw.ANIM_SPEED??1);
      for(const [key,row]of Object.entries(raw)){
        if(!/^SOUND_PLAY\d+$/.test(key)||clock.fired.has(key)||after<row['1'])continue;
        clock.fired.add(key);
        if((row['3']??100)<100&&random()*100>=(row['3']??100))continue;
        play(row['2'],{actorId:actor.id,...sourceSoundEventMetadata(actor,Boolean(row['4']))});
        played.push({actorId:actor.id,state:pose.state,field:key,name:row['2'],animationTime:after});
        if(played.length>64)played.shift();
      }
      clock.time=time;clocks.set(actor.id,clock);
    },
    clear(){clocks.clear();played.length=0;},
    proof(){return [...played];},
  };
}
