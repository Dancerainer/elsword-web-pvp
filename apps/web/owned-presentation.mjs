/** Catch up outward state events already crossed on a remote owner's clock.
 * Event definitions always come from the frozen profile. Wire packets only
 * identify the action and its fired fields. Remaining stop time is an explicit
 * web latency adapter, not an acquired original-client reconciliation policy.
 */
import {sourceStopDuration,sourceStopRadii,SOURCE_STOP_DISTANCE_VERSION} from '../../packages/combat-core/source-stop-distance-v45.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';
import {sourceExtendedSoundEntryForField} from '../../packages/combat-core/source-extended-sound-v61.mjs';
export function createOwnedPresentation({clock=()=>performance.now()}={}){
  const seen=new Map(),deferred=new Map();
  const identity=actor=>actor.state+':'+actor.stateSerial;
  const receiptKey=(playerId,epoch,actor)=>playerId+':'+epoch+':'+identity(actor);
  return {
    deferControls(playerId,epoch,action){
      const keys=(action.actor?.fired??[]).filter(field=>/^STOP_OTHER_UNIT\d+$/.test(field))
        .map(field=>receiptKey(playerId,epoch,action.actor)+':'+field);
      for(const key of keys)deferred.set(key,(deferred.get(key)??0)+1);
      let active=true;return ()=>{if(!active)return;active=false;for(const key of keys){const count=(deferred.get(key)??1)-1;if(count)deferred.set(key,count);else deferred.delete(key);}};
    },
    capture(simulation,localId){return new Map(simulation.state.actors.filter(a=>a.id!==localId).map(a=>[a.id,{identity:identity(a),fired:new Set(a.fired??[])}]));},
    consume(simulation,before,localId,epochFor=()=>0,additionalElapsed=()=>0,{onlyActorId,historical=false}={}){
      const local=simulation.state.actors.find(a=>a.id===localId);if(!local)return;
      for(const actor of simulation.state.actors){
        if(actor.id===localId||actor.pvpDisconnected||onlyActorId!==undefined&&actor.id!==onlyActorId)continue;
        const raw=(simulation.profileFor?.(actor)??simulation.profile).states[actor.state]?.raw;if(!raw)continue;
        const key=epochFor(actor.id)+':'+identity(actor),prior=before?.get(actor.id);
        const identityKey=actor.id+':'+key;let record=seen.get(identityKey);
        if(!record){record={key,fired:new Set(),stops:new Map(),stateNotified:false};seen.set(identityKey,record);}
        while(seen.size>256)seen.delete(seen.keys().next().value);
        // V0 replaces a remote pose rather than running sim.enter. Reuse the
        // common lifecycle receipt for audio; historical collision catch-up
        // must never close a newer live voice.
        if(!historical){
          const serial=simulation.beginSourceAudioState?.(actor);
          if(!record.stateNotified||Number.isInteger(serial)&&serial!==record.presentationSerial){
            record.stateNotified=true;record.presentationSerial=serial;
            if(Number.isInteger(serial)||prior?.identity!==identity(actor))simulation.emit('stateChanged',actor.id,{state:actor.state,stateSerial:actor.stateSerial,
              audioPresentationSerial:serial,animationName:actor.animationName,reason:'owned-presentation-receipt'});
          }
        }
        for(const field of actor.fired??[]){
          const stop=/^STOP_OTHER_UNIT\d+$/.test(field),controlKey=identityKey+':'+field;
          // A admitted reliable control awaits the next simulation boundary.
          // Its newer replaceable pose must not consume the same receipt first.
          if(stop&&!historical&&deferred.has(controlKey))continue;
          if(!stop&&record.fired.has(field))continue;
          if(!stop&&prior?.identity===identity(actor)&&prior.fired.has(field)){
            record.fired.add(field);continue;
          }
          if(!stop)record.fired.add(field);
          if(/^SOUND_PLAY\d+$/.test(field)&&raw[field]&&!actor.soundSet){simulation.soundEvent(actor,field,raw[field]);continue;}
          const extended=sourceExtendedSoundEntryForField(raw,actor.soundSet,field);
          if(extended){
            // Do not stamp an unseen historical controller as the current
            // live presentation. Known old receipts retain their old stamp.
            if(!historical||Number.isInteger(record.presentationSerial))simulation.sourceExtendedSoundEvent(actor,extended,record.presentationSerial);
            else record.fired.delete(field); // a later live pose may still own this previously unseen cue
            continue;
          }
          const setField=/^set(\d+):(SOUND_PLAY\d+)$/.exec(field);
          if(setField&&actor.soundSet?.selected===Number(setField[1])){
            const sound=raw['SOUND_SET'+setField[1]]?.[actor.soundSet.mode]?.[setField[2]];
            if(sound)simulation.soundEvent(actor,setField[2],sound);continue;
          }
          if(!stop||!raw[field])continue;
          const entry=raw[field],duration=sourceStopDuration(actor,local,entry['2']);
          const elapsed=Math.max(0,actor.animationTime-entry['1'])/Math.max(.01,actor.animationPlaybackSpeed??1)+Math.max(0,additionalElapsed(actor.id));
          const now=clock(),previous=record.stops.get(field),remaining=Math.max(0,duration-elapsed);
          // An already-expired replaceable pose is not proof that its reliable
          // source sample was applied. Conversely a duplicate with the same
          // elapsed clock can never refresh an existing event's deadline.
          if(remaining<=0||previous&&(!historical||elapsed>=previous.elapsed-1e-9))continue;
          const firstAt=previous?.firstAt??now,maximum=Math.max(duration,previous?.duration??0);
          const deadline=Math.min(now+remaining*1000,firstAt+maximum*1000);
          if(previous&&deadline<=previous.deadline+1e-6)continue;
          const applied=Math.max(0,(deadline-now)/1000);if(applied>0){
            record.fired.add(field);record.stops.set(field,{firstAt,deadline,elapsed,duration:maximum});
            requestActorStop(local,'world',applied,actor.id);
            simulation.emit('worldStop',actor.id,{duration:applied,...sourceStopRadii(),distancePolicy:SOURCE_STOP_DISTANCE_VERSION,
              aggregation:'target2016-user-last-record',source:'original2016 STOP queue; remaining-time compensation remains a Web ownership adapter'});}
        }
      }
    },
    clear(){seen.clear();deferred.clear();},
  };
}
