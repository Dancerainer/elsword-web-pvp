/** Original target configuration projectiles and mutation variants. Callback
 * times/yaw use the qualified fixed Add reference; magnitudes and variants
 * remain the 2016 declarations. General homing is independently unsupported. */
import {arcLineBasis} from './archenemy-mesh.mjs';
import {markAddDroneProjectile,ADD_FLICK_MARKED_SUB} from './add-drone-lock.mjs';
import {addDroneMarkTarget} from './add-drone-mark.mjs';
export const ADD_DYNAMO_RESOURCE_ROOTS=Object.freeze({
 RushingDrones:['DamageEffect_AAT_Rushing_Drone'],
 FissionShot:['DamageEffect_ADD_Dividing_Missile_Dynamo','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation',
  'DamageEffect_ADD_Dividing_Missile_Dynamo_DA','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA'],
 FlickDisc:['EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation0','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation1'],
 DelayedExplosion:['DamageEffect_AMM_Countdown_Bomb_Projectile','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation'],
});
const roots=new Set(['DamageEffect_AAT_Rushing_Drone','DamageEffect_ADD_Dividing_Missile_Dynamo','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation',
 'DamageEffect_ADD_Dividing_Missile_Dynamo_DA','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA',
 'DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Main','DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub',
 'DamageEffect_AMM_Countdown_Bomb_Projectile','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation']);
const pylons=new Set(['DamageEffect_APT_Pylon_Dynamo','DamageEffect_Pylon_Buff']);
/** Target Hidden Records names the five configuration skills and extends
 * their duration. This adapter extends only their emitted carrier lifetime,
 * never DAMAGE_TIME (a hit count), child explosion windows or timed events. */
export function applyAddDynamoDuration(sim,a,e){
 if(!e||!['LP','MM','DE'].includes(a.professionId)||!pylons.has(e.name)&&!roots.has(e.name))return;
 let base=e.lifeTimeSeconds;
 if(pylons.has(e.name)){
  const skill=sim.profileFor(a).skillCatalog.find(s=>s.skillId===29204),description=skill?.raw.m_EffectiveDesc?.[skill.maxLevel];
  const match=/Pylon Duration: ([\d.]+) sec/.exec(description??'');if(!match)return;base=Number(match[1]);
 }
 if(!Number.isFinite(base))return;
 const multiplier=a.professionId==='MM'?(a.passivePolicy?.add?.dynamoDurationMultiplier??1):1;
 e.lifeTimeSeconds=Math.fround(base*multiplier);
}
function consume(sim,a,consumer){
 if(!a.sourceAdd?.formation||!(a.sourceAdd.mutation>0))return false;
 if(!consumer){sim.note('add-dynamo-mutation-hook','Mutation consumer missing; keep base without spending',a);return false;}
 return consumer(a,1,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args)})===1;
}
export function addDynamoEvents(sim,a,before,after,{consumeMutation}={}){
 if(a.professionId!=='MM')return;
 const p=sim.profileFor(a),state=p.states[a.state]?.sourceState;
 const fire=(id,time,fn)=>sim.fire(a,'add-dynamo:'+id,time,before,after,fn);
 const born=(name,extra={})=>{const e=sim.createEffect(a,{NAME:name,BONE_NAME:'Bip01',...extra});applyAddDynamoDuration(sim,a,e);return e;};
 if(state==='ANSI_A_AAT_RUSHING_DRONE_DYNAMO')fire('rushing',.4,()=>{
  const locked=markAddDroneProjectile(sim,a,born('DamageEffect_AAT_Rushing_Drone'));
  a.skillContext.addRushingMarked=locked;
  if(!(a.skillContext?.addMutationSpent>0)||locked)return;
  // Without an acquired Drone Activator lock the qualified callback emits
  // both at .4; .6 is only the locked second-shot branch.
  const sample=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a);
  if(!sample){sim.note('add-rushing-mutation-bone','Original Bip01 sample required for mutation spread',a);return;}
  const basis=arcLineBasis(a,sim.map.lines),rotation=[...basis.rotation];rotation[1]+=30;
  const e=sim.createEffect(a,{NAME:'DamageEffect_AAT_Rushing_Drone'},{birthAnchor:{position:[...sample.position],facing:a.facing,rotation}});applyAddDynamoDuration(sim,a,e);
 });
 if(state==='ANSI_A_AAT_RUSHING_DRONE_DYNAMO'&&a.skillContext?.addRushingMarked&&a.skillContext?.addMutationSpent>0)
  fire('rushing-marked-second',.6,()=>markAddDroneProjectile(sim,a,born('DamageEffect_AAT_Rushing_Drone')));
 if(state==='ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO')fire('fission',.4,()=>{
  const locked=!!addDroneMarkTarget(sim,a),mutation=consume(sim,a,consumeMutation);
  const e=born('DamageEffect_ADD_Dividing_Missile_Dynamo'+(mutation?'_Mutation':'')+(locked?'_DA':''));
  if(locked)markAddDroneProjectile(sim,a,e);
 });
 if(state==='ANSI_A_AMM_COUNTDOWN_BOMB_DYNAMO')fire('countdown',.3,()=>{
  const mutation=consume(sim,a,consumeMutation);markAddDroneProjectile(sim,a,born('DamageEffect_AMM_Countdown_Bomb_Projectile'+(mutation?'_Mutation':'')));
 });
 if(state==='ANSI_A_AMM_FLICK_DISC_DYNAMO')fire('flick',.3,()=>{
  const mutation=consume(sim,a,consumeMutation),names=mutation?ADD_DYNAMO_RESOURCE_ROOTS.FlickDisc.slice(1):ADD_DYNAMO_RESOURCE_ROOTS.FlickDisc.slice(0,1),locked=!!addDroneMarkTarget(sim,a);
  const source=locked?{...a,skillScale:Math.fround(a.skillScale*1.2000000476837158)}:a;
  const first=sim.state.nextEffectId;for(const name of names)sim.spawnSet(source,name);
  for(const e of sim.state.effects)if(e.ownerId===a.id&&e.id>=first){applyAddDynamoDuration(sim,a,e);if(mutation)e.powerMultiplier*=1.1;
   if(locked&&e.name===ADD_FLICK_MARKED_SUB)markAddDroneProjectile(sim,a,e);
  }
 });
}
