/** Target32749110: create first, then change only this Energy Boom instance.
 * The source key144 is lifetime, not the older1.217 range declaration. */
export function applyAddEnergyBoomMutation(sim,a,e,{consumeMutation}={}){
 if(!e||!a.sourceAdd?.formation||!(a.sourceAdd.mutation>0))return false;
 const profile=sim.profileFor(a),skill=profile.skillCatalog.find(s=>s.skillId===29000)||profile.skillCatalog.find(s=>s.skillId===29026);
 const rate=skill?.raw?.SA_PROJECTILE_RANGE_REL_2?.[skill.maxLevel];
 if(!Number.isFinite(rate)||typeof consumeMutation!=='function')return false;
 e.sourceAddEnergyBoomMutation=true;
 if(Number.isFinite(e.lifeTimeSeconds))e.lifeTimeSeconds=Math.fround(e.lifeTimeSeconds*rate);
 if(e.sourceShadowMesh)e.sourceShadowMesh.maxLifeTime=Math.fround(e.sourceShadowMesh.maxLifeTime*rate);
 for(const axis of ['X','Y','Z'])e.definition['SCALE_'+axis]=(e.definition['SCALE_'+axis]??1)*1.5;
 const spent=consumeMutation(a,1,{profile,emit:(...args)=>sim.emit(...args)});
 if(a.skillContext)a.skillContext.addMutationSpent=spent;
 return true;
}
