/** Source-only private profile closure. Frozen raw profiles stay unchanged. */
import bhAirFire from '../../contracts/bh-air-fire-visual-v45.json' with {type:'json'};
import caShield from '../../contracts/ca-shield-visual-v45.json' with {type:'json'};
import source from '../../contracts/elesis-attack-closure-v45.json' with {type:'json'};
import firewall from '../../contracts/elesis-firewall-npc-v45.json' with {type:'json'};
import caCommands from '../../contracts/ca-command-closure-v58.json' with {type:'json'};
export function installElesisFeedbackSource(profile){
 const closure=profile.target?.unitClass===125?source:profile.target?.unitClass===121?source.bh:null;
 if(!closure)return profile;
 if(profile.target?.unitClass===121){
  const name='EffectSet_Wall_of_Prominence_Attack';
  profile.effectSets[name]??=structuredClone(firewall.effectSets[name]);
 }
 for(const key of ['effectSets','damageEffects','effectTemplates']){
  profile[key]??={};
  for(const[name,row]of Object.entries({...closure[key],...(profile.target.unitClass===125?caCommands[key]:{})})){
   if(profile[key][name]&&JSON.stringify(profile[key][name].raw??profile[key][name])!==JSON.stringify(row.raw??row))
    throw new TypeError('Conflicting original Elesis feedback declaration '+key+'.'+name);
   profile[key][name]??=structuredClone(row);
  }
 }
 const visuals=profile.target.unitClass===125?caShield:bhAirFire;
 for(const[name,t]of Object.entries(visuals.templates)){
  if(profile.effectTemplates[name]){if(profile.effectTemplates[name].declarationSha256!==t.declarationSha256)throw new TypeError('Conflicting original Elesis shield '+name);continue;}
  const initial=Object.fromEntries(t.events.filter(e=>e.start===0&&!e.fade).map(e=>[e.property,e.value]));
  profile.effectTemplates[name]={...structuredClone(t),initialSize:initial.Size??null,initialVelocity:initial.Velocity??null,initialDirSpeed:initial.DirSpeed??null,
   initialAnimation:initial.AniName?{name:initial.AniName.animation,playback:initial.AniName.playback}:null,missingExplicitTickRate:t.animationMissingTickRate??false};
 }
 return profile;
}
