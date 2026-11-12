/** Original2016 DE aerial ZX / dashXXX producers. Their registered frame
 * callbacks reuse the same literal three-resource gate and projectile. */
import closure from '../../contracts/add-de-command-closure-v45.json' with {type:'json'};
import dashXxx from '../../contracts/de-dash-xxx-v58.json' with {type:'json'};
import visuals from '../../contracts/de-air-combo-visual-v45.json' with {type:'json'};
import {changeAddDp} from './add-systems.mjs';
export const ADD_DE_ZX_SET='EffectSet_AAT_DashJumpCombo_ZZX';
export const ADD_DE_DASH_XXX_SET='EffectSet_ADE_DashCombo_XXX_Bomb';
const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?
 Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
export function installAddDeCommandSource(profile){
 if(profile.target?.unitClass!==126)return profile;
 if(!visuals.referenceVersion.endsWith(profile.target.build))throw TypeError('DE command source target mismatch');
 for(const group of ['effectSets','damageEffects'])for(const[name,row]of Object.entries({...closure[group],...dashXxx[group]})){
  const old=profile[group][name];
  if(old&&canonical(old.raw??old)!==canonical(row.raw??row))throw TypeError('Conflicting original DE command '+name);
  profile[group][name]??=structuredClone(row);
 }
 for(const[name,template]of Object.entries(visuals.templates)){
  const old=profile.effectTemplates[name];
  if(old){if(old.declarationSha256!==template.declarationSha256||old.kind!==template.kind)throw TypeError('Conflicting original DE command template '+name);continue;}
  const initial=Object.fromEntries(template.events.filter(e=>e.start===0&&!e.fade).map(e=>[e.property,e.value]));
  profile.effectTemplates[name]={...structuredClone(template),initialSize:initial.Size??null,initialVelocity:initial.Velocity??null,
   initialDirSpeed:initial.DirSpeed??null,initialAnimation:initial.AniName?{name:initial.AniName.animation,playback:initial.AniName.playback}:null,
   missingExplicitTickRate:template.animationMissingTickRate??false};
 }
 return profile;
}
function fireAddDeCommand(sim,a,setName,{eventName,reason,evidence}){
 if(a.professionId!=='DE')return false;
 const profile=sim.profileFor(a),dpMode=a.passivePolicy?.skillLevels?.[29410]>0&&a.sourceAdd?.formation===true;
 if(dpMode){
  // Gate compares the declared rawDP3 before option-aware ChangeDP(-3,1).
  if(a.sourceAdd.dp<3)return false;
  changeAddDp(a,-3,{profile,emit:(...args)=>sim.emit(...args),reason});
 }else{
  if(a.mp<3)return false;
  a.mp=Math.fround(a.mp-3);
 }
 const first=sim.state.nextEffectId;sim.spawnSet(a,setName);
 // Original PlayEffectSet uses the owner's absolute animation clock
 // (321cba0d..321cba3c), also sealed by add-awakening-native-v45. Its
 // .25 member threshold does not acquire an extra .01 callback offset.
 for(const e of sim.state.effects)if(e.id>=first&&e.ownerId===a.id&&e.setName===setName&&e.clock==='animation')e.setStartAnimation=0;
 sim.emit(eventName,a.id,{resource:dpMode?'DP':'MP',declaredAmount:3,evidence});
 return true;
}
export function fireAddDeAerialZx(sim,a){
 return fireAddDeCommand(sim,a,ADD_DE_ZX_SET,{eventName:'addDeAerialZx',reason:'original-de-aerial-zx',
  evidence:'original2016 registered32756e00 .01 gate3 +327427d0; client battle unmeasured'});
}
export function fireAddDeDashXxx(sim,a){
 return fireAddDeCommand(sim,a,ADD_DE_DASH_XXX_SET,{eventName:'addDeDashXxx',reason:'original-de-dash-xxx',
  evidence:'original2016 registered327763c0->32757010 .01 gate3 +327427d0, original Bomb set .25; client battle unmeasured'});
}
