/** Current Web configuration metadata only. No source assets or combat executors
 * enter the light lobby bundle. Regenerate whenever profile/preset selection
 * capabilities change; source data is neither altered nor called original UI. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';
const root=new URL('../../',import.meta.url),professions={};
for(const id of PROFESSION_IDS){
 const name=id.toLowerCase(),paths=['packages/combat-core/'+name+'-profile.json','config/'+name+'-preset.json'];
 const bytes=await Promise.all(paths.map(path=>readFile(new URL(path,root))));
 const [profile,preset]=bytes.map(value=>JSON.parse(value));
 const capabilities=Object.fromEntries(profile.skillCatalog.map(skill=>{
  const keys=['skillId','supported','selectable','passive','pvpDisabled','disabledReason','branches','limitations'];
  const row=Object.fromEntries(keys.filter(key=>Object.hasOwn(skill,key)).map(key=>[key,skill[key]]));
  if(preset.bannedSkillIds?.includes(skill.skillId))Object.assign(row,{supported:false,pvpDisabled:true,
   disabledReason:preset.bannedSkillReasons?.[skill.skillId]??'Unavailable in PvP'});
  return [skill.skillId,row];
 }));
 professions[id]={skillKeys:preset.skillKeys,passives:preset.passives??[],
  defaults:preset.loadout??(id==='RF'?[{skillId:24027},{skillId:24203},{skillId:24217},{skillId:24219},null,null,null,null]:Array(8).fill(null)),
  capabilities,inputs:Object.fromEntries(paths.map((path,i)=>[path,createHash('sha256').update(bytes[i]).digest('hex')]))};
}
const value={schemaVersion:1,evidenceClass:'current-Web-profile-selection-metadata; not original-client UI',professions};
await writeFile(new URL('contracts/lobby-config-v45.json',root),JSON.stringify(value)+'\n');
console.log(JSON.stringify({professions:Object.keys(professions).length,bytes:Buffer.byteLength(JSON.stringify(value))}));
