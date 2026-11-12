/** Explicit target adapters where the 2016 declaration replaced a V5 field.
 * These policies are selectable runtime candidates, never a client measurement.
 */
export function arcNativeInput(actor,worldEffects,{kind,dt,randValues,defender=null,defenderUID=null,basis}={}){
  const saved=actor.sourceArcEnemy??{data:[],effects:[],cooldown:0,nextHandle:1,effectIds:{}};
  const effects=saved.effects.map(x=>{
    const e=worldEffects.find(e=>e.id===saved.effectIds[x.handle]);
    if(!e||e.dead)return {...x,alive:false};
    return {...x,alive:true,position:[...(e.currentAnchor??e.birthAnchor).position],rotation:[...(e.currentAnchor??e.birthAnchor).rotation],
      nowLifeTime:e.meshLifetimeElapsed??e.elapsed,maxLifeTime:e.lifeTimeSeconds??x.maxLifeTime};
  });
  return {kind,time:actor.animationTime,before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,
    dt,hp:actor.hp,hpMax:actor.hpMax,power:actor.skillScale,awakening:actor.awakening.remaining,
    grounded:actor.grounded,position:[actor.x,actor.y,actor.z],rotation:basis?.rotation??[0,actor.facing<0?180:0,0],direction:basis?.direction??[1,0,0],
    landY:actor.landPosition?.[1]??actor.y,isRight:actor.facing>0,memo:false,
    arcEnemy:{...saved,effects,zDirection:basis?.zDirection??[0,0,1],randValues:randValues??[0,0,0,0],newEffectMaxLifeTime:30,
      defenderType:defender?'unit':'none',dummyDamage:false,defender:defender?{type:'user',uid:defenderUID}:null}};
}
