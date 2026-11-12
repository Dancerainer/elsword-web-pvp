import {createSampledKeyboardBuffer} from './sampled-keyboard.mjs';
/** Legacy inspector edge adapter; live keyboard uses sampled device levels. */
export function createInputBuffer({sampledLevels=false}={}) {
  if(sampledLevels)return createSampledKeyboardBuffer();
  const physical=new Set(), simulated=new Set(), queue=[];
  return {
    down(key,time=0){if(physical.has(key))return false;physical.add(key);queue.push({key,down:true,time});return true;},
    up(key,time=0){if(!physical.delete(key))return false;queue.push({key,down:false,time});return true;},
    tap(key,time=0){queue.push({key,down:true,time},{key,down:false,time});},
    clear(){physical.clear();simulated.clear();queue.length=0;},
    releaseAll(time=0){for(const key of [...physical])this.up(key,time);},
    consume(cutoff=Infinity){
      if(cutoff!==Infinity&&!Number.isFinite(cutoff))throw new TypeError('Finite input cutoff or Infinity required');
      const pressed=[],released=[],edges=[];
      const deferred=[],blocked=new Set();
      // Retain the existing web multi-tap adapter, one press per key per packet.
      // WinKey::Read consumes all eligible events into a final level; this
      // extra per-key delay is not that original device consumer. A delayed
      // key must not prevent another key from reaching its own packet cutoff.
      for(const e of queue){
        if(blocked.has(e.key)||e.time>cutoff||e.down&&pressed.includes(e.key)){
          deferred.push(e);blocked.add(e.key);continue;
        }
        edges.push(e);if(e.down){simulated.add(e.key);pressed.push(e.key);}else{simulated.delete(e.key);released.push(e.key);}
      }
      queue.length=0;for(const e of deferred)queue.push(e);
      return {held:[...simulated],pressed,released,edges};
    },
    get pending(){return queue.length;},
  };
}
