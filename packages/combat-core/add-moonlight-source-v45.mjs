/** Explicit original Moonlight attack/visual closure for private profiles.
 * Buff display installation stays in its independent buff-only catalog.
 * Triggering, attacker ownership and target semantics remain with consumers. */
import attacks from '../../contracts/add-moonlight-explosions-v45.json' with {type:'json'};
import visuals from '../../contracts/de-moonlight-visual-v45.json' with {type:'json'};
export const ADD_MOONLIGHT_EXPLOSION_SETS=Object.freeze(Object.keys(attacks.effectSets));
const canonical=value=>JSON.stringify(value,(_,row)=>row&&typeof row==='object'&&!Array.isArray(row)?
 Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
export function installAddMoonlightSource(profile){
 if(!profile?.target?.build||!visuals.referenceVersion.endsWith(profile.target.build))throw TypeError('Moonlight source target version mismatch');
 for(const group of ['effectSets','damageEffects']){
  profile[group]??={};
  for(const[name,row]of Object.entries(attacks[group])){
   const old=profile[group][name];
   if(old&&canonical(old.raw??old)!==canonical(row.raw??row))throw TypeError('Conflicting original Moonlight '+group+'.'+name);
   profile[group][name]??=structuredClone(row);
  }
 }
 profile.effectTemplates??={};
 for(const[name,template]of Object.entries(visuals.templates)){
  const old=profile.effectTemplates[name];
  if(old){if(old.declarationSha256!==template.declarationSha256||old.kind!==template.kind)throw TypeError('Conflicting original Moonlight template '+name);continue;}
  const initial=Object.fromEntries(template.events.filter(event=>event.start===0&&!event.fade).map(event=>[event.property,event.value]));
  profile.effectTemplates[name]={...structuredClone(template),initialSize:initial.Size??null,initialVelocity:initial.Velocity??null,
   initialDirSpeed:initial.DirSpeed??null,initialAnimation:initial.AniName?{name:initial.AniName.animation,playback:initial.AniName.playback}:null,
   missingExplicitTickRate:template.animationMissingTickRate??false};
 }
 return profile;
}
