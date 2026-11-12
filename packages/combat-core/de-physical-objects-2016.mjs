/** Explicit typed Web object bridge for original physics side effects. Native
 * addresses/TLS records are not aliases of JS actor positions. Objects bind
 * their actual lifetime/placement methods; absent Web objects are empty
 * containers, rather than fabricated instances from a startup heap capture. */
import {clearAddVoidBoundPosition} from './add-void-binding-v57.mjs';
const f=Math.fround,vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function updateDePhysicalModel2016(model,query){
 if(!model||!model.enabled||model.parent&&!model.parent.active)return false;
 model.refreshTransform?.();
 if(!vec(model.worldCenter)||!vec(query.position)||!vec(model.scale)||!Number.isFinite(model.radius)||!Array.isArray(query.planes)||query.planes.length!==6||query.planes.some(p=>!Array.isArray(p)||p.length!==4||!p.every(Number.isFinite)))throw new TypeError('Explicit physical model/planes required');
 model.distanceCache=f(Math.hypot(...model.worldCenter.map((v,i)=>v-query.position[i])));
 const radius=model.parent?model.parent.radius:model.radius;
 if(!(radius>0))return true; // Original early return retains old40/58.
 const extent=radius*Math.max(...model.scale)+(query.extraRadius??0);model.planeIndex=-1;
 for(let index=0;index<6;index++){const p=query.planes[index],distance=p[0]*model.worldCenter[0]+p[1]*model.worldCenter[1]+p[2]*model.worldCenter[2]+p[3];if(distance< -extent){model.planeIndex=index;model.outside=true;return false;}}
 model.outside=false;return true;
}
export function createDePhysicalObjects2016(sim){
 const rows=new WeakMap(),row=unit=>{let state=rows.get(unit);if(!state){state={model:null,cullQuery:null,supportReferences:[],associatedPet:null,cache:null,mode3Latch:false};rows.set(unit,state);}return state;};
 return {
  bind(unit,{model=null,cullQuery=null,supportReferences=[],associatedPet=null}={}){
   if(!Array.isArray(supportReferences)||associatedPet&&typeof associatedPet.placeOnOriginalLineMap!=='function'||model&&!cullQuery)throw new TypeError('Incomplete typed physical object binding');
   Object.assign(row(unit),{model,cullQuery,supportReferences,associatedPet});return row(unit);
  },
  state:row,
  collider(unit,{position,width,height,kind='user',mode,localPredicate=false}){
   if(!vec(position)||!Number.isFinite(width)||!Number.isFinite(height))throw new TypeError('Explicit typed collider required');
   const state=row(unit);
   if(state.cache?.frame!==sim.state.step)state.cache={frame:sim.state.step,valid:true,position:[...position],width,height};
   if(kind==='npc'&&mode===3&&localPredicate)state.mode3Latch=true;
   return state.cache;
  },
  model(unit){const state=row(unit);if(state.model)updateDePhysicalModel2016(state.model,state.cullQuery);},
  resetSupport(unit){
   clearAddVoidBoundPosition(unit);
   const state=row(unit),refs=state.supportReferences;
   // Whole-range erase, decrement in original order, virtual destruction on0.
   for(const object of refs){if(!Number.isSafeInteger(object.referenceCount)||object.referenceCount<1||typeof object.destroy!=='function')throw new TypeError('Invalid owned support reference');object.referenceCount--;if(object.referenceCount===0)object.destroy(sim,unit);}
   refs.length=0;
   const pet=state.associatedPet;if(!pet||pet.repositioned)return;
   // placeOnOriginalLineMap is this concrete object's exact placement method;
   // its candidate/map/source flags remain instance inputs, not owner aliases.
   if(pet.placeOnOriginalLineMap(sim,unit)!==true)return;
   pet.repositioned=true;
   if(pet.summonRequested)sim.emit?.('petSummonRequested',unit.id,{setName:'EffectSet_Summon_Pet',sound:'Pet_Summon.ogg',attack:false});
  },
 };
}
