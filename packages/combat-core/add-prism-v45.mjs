/** Original Particle Prism cast, sole mesh carrier and endpoint lifetime.
 * Destructible NPC combat remains separate from this authored field adapter. */
import {arcLineBasis} from './archenemy-mesh.mjs';
import {startAddPrismEndpoints} from './add-prism-endpoints-2016.mjs';
export const ADD_PRISM_SET='EffectSet_SA_AN_PARTICLE_PRISM';
export const ADD_PRISM_DAMAGE_SET='EffectSet_SA_AN_PARTICLE_PRISM_DAMAGE';
export const ADD_COMMON_BONE_TARGETS=Object.freeze({
 [ADD_PRISM_SET]:['DamageEffect_Particle_Prism_Debuff','DamageEffect_Particle_Prism_Debuff_Use_Mutation'],
 [ADD_PRISM_DAMAGE_SET]:['DamageEffect_Particle_Prism'],
});
export function startAddPrism(sim,a,{consumeMutation,bindSet}={}){
 const profile=sim.profileFor(a),raw=profile.effectSets[ADD_PRISM_SET]?.raw;if(!raw)return false;
 const own=sim.networkOwnerId==null||sim.networkOwnerId===a.id;
 if(!own&&sim.networkCombatPlaybackVersion!==1)return false;
 if(!own&&sim.state.effects.some(e=>e.ownerId===a.id&&e.setName===ADD_PRISM_SET&&e.ownerStateSerial===a.stateSerial&&!e.dead))return true;
 let spent=0;if(own&&a.sourceAdd?.formation&&a.sourceAdd.mutation>0&&consumeMutation)
  spent=consumeMutation(a,1,{profile,emit:(...args)=>sim.emit(...args)});
 else if(!own&&a.sourceAdd?.formation)spent=[0,1].includes(a.skillContext?.addMutationSpent)?a.skillContext.addMutationSpent:a.sourceAdd.mutation>0?1:0;
 if(own&&a.skillContext)a.skillContext.addMutationSpent=spent;
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.setName===ADD_PRISM_SET&&!e.dead){e.dead=true;e.endReason='original-prism-replaced';}
 // Original constants33060308=1.5700000524520874 and32ff1c58=
 // .01745329238474369, not an exact90-degree replacement.
 const basis=arcLineBasis(a,sim.map.lines),r=Math.fround(basis.rotation[1]*.01745329238474369+1.5700000524520874);
 const position=[Math.fround(a.x+Math.fround(Math.sin(r))*50),a.y,Math.fround(a.z+Math.fround(Math.cos(r))*50)];
 // Actor scale is a real instance input. This Web body model uses the
 // frozen1 actor base scale; mutation does not add a fabricated1.4 factor.
 const other=position.map((n,i)=>Math.fround(n+(i===0?650*a.facing:0)));
 const oldHandle=sim.state.effects.findLast(e=>e.ownerId===a.id&&e.setName===ADD_PRISM_SET)?.sourceBoneEffectSetId??null;
 startAddPrismEndpoints(sim,a,position,other,oldHandle);
 const first=sim.state.nextEffectId;
 for(const[member,row]of Object.entries(raw))if(/^EFFECT\d+$/.test(member)){
  const carrier=row.BONE_TRACE_TARGET_MESH===1;
  const birthAnchor=carrier?{position:position.map((n,i)=>n+(row[['POSITION_OFFSET_X','POSITION_OFFSET_Y','POSITION_OFFSET_Z'][i]]??0)*(i===0?a.facing:1)),
   rotation:arcLineBasis(a,sim.map.lines).rotation,facing:a.facing,customPosition:true}:undefined;
  const e=sim.createEffect(a,row,{setName:ADD_PRISM_SET,clock:'custom',start:row.START_TIME??0,hyperMode:spent>0,birthAnchor});
  if(e)e.definitionMember=member;
 }
 bindSet(sim.state.effects.filter(e=>e.id>=first));
 sim.emit('addPrismStarted',a.id,{mutationSpent:spent,startPosition:position,evidence:'original2016 registered32757970 + source NPC endpoint lifetime; client battle unmeasured'});
 return true;
}
export function addPrismSetExpired(sim,a,e){
 if(e.setName!==ADD_PRISM_SET||!['LP','MM','DE'].includes(a.professionId)||![29003,29029].includes(e.skillId))return false;
 // The successful group's sourceBoneTargetMeshId already ends the entire
 // group when its10-second carrier mesh becomes invalid. Endpoint6.9s and
 // ownerHP0 are not caster-object destruction and cannot replace that gate.
 return a.pvpDisconnected===true;
}
