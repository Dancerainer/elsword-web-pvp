import {readFile,writeFile} from 'node:fs/promises';
// SlashTrace is independent display work. Preserve the original audit event.
const allowed=new Set(['Color','Size','Velocity','DirSpeed','AniName','AniSpeed','Rotate','SlashTrace']);
const rows=new Map();
for(const id of ['lp','mm','de']){
 const profile=JSON.parse(await readFile('packages/combat-core/'+id+'-profile.json','utf8'));
 for(const damage of Object.values(profile.damageEffects)){
  const name=damage.raw.MAIN_EFFECT_NAME,t=profile.effectTemplates[name];
  if(!t||t.fields.MeshType!=='X_SKIN_MESH'||t.fields.LifeType!=='LT_TIME'||!(t.fields.LifeTime>0)||t.unsupported.length)continue;
  if(!t.events.some(e=>e.property==='DirSpeed'&&e.value!==0||e.property==='Velocity'&&e.value.some(v=>v!==0)))continue;
  if(t.events.some(e=>!allowed.has(e.property)||e.property==='AniName'&&e.fade||e.property==='AniSpeed'&&e.fade))continue;
  const row={name,source:t.source,declarationSha256:t.declarationSha256,fields:t.fields,events:t.events,professions:[id.toUpperCase()]};
  const previous=rows.get(name);
  if(previous){if(previous.declarationSha256!==row.declarationSha256)throw Error('Conflicting original Add mesh '+name);previous.professions.push(id.toUpperCase());}
  else rows.set(name,row);
 }
}
const records=[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name));
const report={schemaVersion:1,evidenceClass:'target2016 original mesh declarations bound to scoped source-referenced executor',originalClientMeasured:false,
 consumer:'bounded binary32 velocity/fade/DirSpeed/land executor; unknown events remain unsupported',rows:records};
await writeFile('contracts/add-literal-meshes-v31.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({auditedMovingMeshes:records.length,names:records.map(r=>r.name)}));
