/** Fixed-reference sampled device -> Manager action -> Game order. No target2016 recording. */
const directions=['LEFT','RIGHT','UP','DOWN'];
const order=[...directions,'Z','X','A','S','D','C','Q','W','E','R','AWAKEN'];
const blank=()=>({first:false,up:false,timeout:0,double:false,doubleLock:false});
export function createSampledKeyboardBuffer(){
  const physical=new Set(),levels=new Set(),locks=new Set(),double=new Map(),queue=[];
  let previousCutoff=null;
  const getDouble=(key,pure)=>{
    const d=double.get(key),held=levels.has(key);
    if(!d.double){
      if(!d.first){if(held&&!locks.has(key)){d.first=true;d.timeout=Math.fround(.4);}return false;}
      if(!d.up){if(!held)d.up=true;return false;}
      if(held&&!locks.has(key))d.double=true;else return false;
    }
    if(d.double&&held&&(pure||!d.doubleLock)){if(!pure)d.doubleLock=true;return true;}
    double.set(key,blank());return false;
  };
  return {
    down(key,time=0){if(physical.has(key))return false;physical.add(key);queue.push({key,down:true,time});return true;},
    up(key,time=0){if(!physical.delete(key))return false;queue.push({key,down:false,time});return true;},
    // Explicit inspector taps remain separate from sampled DOM levels.
    tap(key,time=0){queue.push({key,down:true,time,manual:true},{key,down:false,time,manual:true});},
    clear(){physical.clear();levels.clear();locks.clear();double.clear();queue.length=0;previousCutoff=null;},
    releaseAll(time=0){for(const key of [...physical])this.up(key,time);},
    consume(cutoff=Infinity,elapsed=1/60){
      if(cutoff!==Infinity&&!Number.isFinite(cutoff))throw new TypeError('Finite input cutoff or Infinity required');
      if(!Number.isFinite(elapsed)||elapsed<0)throw new RangeError('Finite nonnegative device elapsed time required');
      if(previousCutoff!==null&&cutoff!==Infinity&&cutoff<previousCutoff)throw new RangeError('Keyboard sample cutoff must be monotonic');
      const dt=Math.fround(elapsed);
      if(cutoff!==Infinity)previousCutoff=cutoff;
      const edges=[],before=new Set(levels),manual=[];
      // WinKey Read / DI device level sample precedes Manager action processing.
      while(queue.length&&queue[0].time<=cutoff){const e=queue.shift();edges.push(e);if(e.manual){if(e.down)manual.push(e.key);continue;}
        if(e.down)levels.add(e.key);else levels.delete(e.key);}
      for(const key of order){
        if(!double.has(key))double.set(key,blank());
        if(!levels.has(key))locks.delete(key);
        const d=double.get(key);if(d.first&&!d.double){d.timeout=Math.fround(d.timeout-dt);if(d.timeout<0)double.set(key,blank());}
      }
      const pressed=[],pureDouble=[],oneDouble=[];
      // Game InputData: doublePure -> doubleOne -> pure -> one, per key.
      for(const key of order){
        if(getDouble(key,true))pureDouble.push(key);
        if(getDouble(key,false))oneDouble.push(key);
        if(levels.has(key)&&!locks.has(key)){locks.add(key);pressed.push(key);}
      }
      for(const key of manual)if(!pressed.includes(key))pressed.push(key);
      return {held:[...levels],pressed,released:[...before].filter(k=>!levels.has(k)),edges,
        sampledDevice:manual.length===0,pureDouble,oneDouble};
    },
    get pending(){return queue.length;},
  };
}
