/** Original327433a0 orchestration. The bridge must implement the complete
 * selected physical consumer including persistent side effects. A geometry
 * query, linear extrapolation or position-only clone is not this capability. */
const vector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const f=Math.fround;
export const ADD_DE_PHYSICS_HOST='de-prediction-real-web-physics-2016-v53';
/** The selected native caller now runs the real Web unit physics executor.
 * This host is deliberately identified separately from a complete translation
 * of native31f6c810. It retains the project's qualified physics and approved
 * map policies, and never substitutes velocity*time for the eight calls. */
export function createAddDePredictionPhysics(sim){
 const frames=new WeakMap();
 return {
  ruleVersion:ADD_DE_PHYSICS_HOST,
  recordFrame(actor,elapsed){if(Number.isFinite(elapsed)&&elapsed>0)frames.set(actor,f(elapsed));},
  fullPhysicsStep(actor){
   const elapsed=frames.get(actor);if(!(elapsed>0))throw new TypeError('DE prediction requires the actual actor physical frame delta');
   const previous=sim.dePredictionActive;sim.dePredictionActive=actor;
   try{const def=sim.profileFor(actor).states[actor.state],before=actor.lineId;sim.dePhysicalObjects.model(actor);sim.integrate(actor,elapsed,{held:new Set(),pressed:new Set(),released:new Set()},def,actor.animationTime,{sourceFuture:true});if(before!==actor.lineId)sim.dePhysicalObjects.resetSupport(actor);}
   finally{sim.dePredictionActive=previous;}
  },
  // Native1ac is signed along facing, while the Web actor stores world-line X.
  readHorizontal:actor=>f(actor.vx*actor.facing),
  writeHorizontal(actor,value){actor.vx=f(value*actor.facing)||0;},
  readSupportY:actor=>actor.landPosition?.[1],
  queryDown({position,radius,lineIndex,flags}){
   if(typeof sim.nativeGeometry?.down!=='function')throw new TypeError('Original CanDown module is required');
   const q=sim.nativeGeometry.down({position,radius,lastLineId:sim.map.lines[lineIndex]?.lineId,downRadius:!!flags[0],isMonster:!!flags[1],onLine:!!flags[2]});
   return {found:q.found,lineIndex:q.nativeIndex,point:q.rawPoint??q.point};
  },
  lineAt(index){const line=sim.map.lines[index];if(!line)return null;const raw=line.type??line.nativeFields?.LINE_TYPE,type=raw?.symbol??raw?.$symbol??raw,enabled=line.enabled??line.nativeFields?.ENABLE??true;
   return {type:[0,'LT_NORMAL','LINE_TYPE.LT_NORMAL'].includes(type)?0:type,enabled:[true,1,'TRUE'].includes(enabled?.symbol??enabled?.$symbol??enabled)};},
  available:actor=>frames.has(actor)&&typeof sim.nativeGeometry?.down==='function',
 };
}
export function queueAddDePhysicalState(sim,actor,state,reason){
 if(sim.dePredictionActive!==actor)return false;
 if(!sim.profileFor(actor).states[state])throw new TypeError('Unknown physical state request');
 actor.sourceAddCombat.predictionRequest={state,reason,fromStateSerial:actor.stateSerial};
 sim.emit?.('dePredictionStateRequested',actor.id,{state,reason,force:false});return true;
}
export function flushAddDePhysicalState(sim,actor){
 const request=actor.sourceAddCombat?.predictionRequest;if(!request)return false;
 delete actor.sourceAddCombat.predictionRequest;
 if(request.fromStateSerial!==actor.stateSerial)return false;
 sim.enter(actor,request.state,request.reason);return true;
}
export function validateAddDePhysicalRequest(value){
 if(!value||typeof value!=='object'||Object.keys(value).length!==3||typeof value.state!=='string'||!value.state||value.state.length>128||typeof value.reason!=='string'||!value.reason||value.reason.length>128||!Number.isSafeInteger(value.fromStateSerial)||value.fromStateSerial<1)throw new TypeError('Invalid DE physical state request');return true;
}
export const ADD_DE_PREDICTION_REQUIREMENTS=Object.freeze(['fullPhysicsStep','readHorizontal','writeHorizontal','readSupportY','queryDown','lineAt']);
export function executeAddDePrediction2016(actor,bridge){
 if(!bridge||ADD_DE_PREDICTION_REQUIREMENTS.some(n=>typeof bridge[n]!=='function'))throw new TypeError('Complete target2016 physical bridge is required for DE eight-step prediction');
 const entry=[actor.x,actor.y,actor.z];let lineIndex=0;
 for(let step=0;step<8;step++){
  bridge.writeHorizontal(actor,bridge.readHorizontal(actor)-500);
  bridge.fullPhysicsStep(actor);
 }
 const query=position=>{const q=bridge.queryDown({position:[...position],radius:30,lineIndex,flags:[0,0,1]});if(!q||typeof q.found!=='boolean'||!Number.isInteger(q.lineIndex)||!vector(q.point))throw new TypeError('CanDown must return raw point/index even on failure');lineIndex=q.lineIndex;return q;};
 let q=query([actor.x,actor.y,actor.z]),line=bridge.lineAt(lineIndex);
 let successful=q.found&&line?.type===0&&line.enabled===true;
 if(!successful){q=query(entry);successful=q.found;}
 const output=successful?[q.point[0],Math.max(q.point[1],entry[1]-600),q.point[2]]:[entry[0],bridge.readSupportY(actor),entry[2]];
 if(!vector(output))throw new TypeError('Prediction requires the actual post-eight-step supportY');
 // Never restore actor snapshots, other units, model caches, pending states,
 // HP, portals, associated pets, or reference-owned containers here.
 [actor.x,actor.y,actor.z]=entry;bridge.writeHorizontal(actor,0);
 return {position:output,lineIndex,steps:8};
}
export function applyAddDePrediction2016(sim,actor){
 if(actor.professionId!=='DE'||sim.profileFor(actor).states[actor.state]?.sourceState!=='ANSI_ATT_DASH_JUMP_COMBO_ZX')return false;
 if(sim.networkOwnerId!=null&&sim.networkOwnerId!==actor.id)return false;
 const bridge=sim.addPredictionPhysics;
 if(!bridge||bridge.available&&!bridge.available(actor)){sim.note('de-prediction-physical-frame-input','Original eight-step prediction needs actual actor frame delta and CanDown; no default delta or linear teleport substituted.',actor);return false;}
 const entry=[actor.x,actor.y,actor.z],result=executeAddDePrediction2016(actor,bridge);[actor.x,actor.y,actor.z]=result.position;
 sim.emit?.('dePredictionApplied',actor.id,{steps:8,entry,position:[...result.position],lineIndex:result.lineIndex,physicsRule:bridge.ruleVersion??'explicit-complete-physical-bridge',retained:['velocityY','support','modelCaches','stateRequests','HP','mapMechanics','ownedObjectChanges']});return true;
}
