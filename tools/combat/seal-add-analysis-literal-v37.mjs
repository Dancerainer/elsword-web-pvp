/** Small immutable source declarations, not a motion/profile rewrite. */
import {readFileSync,writeFileSync} from 'node:fs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const rows=['ADD_Star_Fall_Attack_Mesh_Start','ADD_Star_Fall_Attack_Mesh_Attack'].map(name=>{
 const t=profile.effectTemplates[name];
 if(!t||t.fields.LifeType!=='LT_TIME'||t.fields.MeshType!=='X_SKIN_MESH'||t.unsupported?.length)throw new Error('Original Starfall literal declaration unavailable: '+name);
 return {name,fields:t.fields,events:t.events,source:t.source,initialAnimation:t.initialAnimation,animationClips:t.animationClips,
  qualification:'Original2016 immutable mesh declaration; scoped Web literal-motion consumer, no target-client measurements'};
});
const output=new URL('../../contracts/add-analysis-literal-meshes-v37.json',import.meta.url);
writeFileSync(output,JSON.stringify({schemaVersion:1,targetClientMeasured:false,evidenceClass:'target2016 original mesh declarations plus scoped existing Web literal motion executor',
 nativeControllerSource:'contracts/add-analysis-consumers-v37.json',rows},null,2)+'\n');
console.log(JSON.stringify({output:output.pathname,rows:rows.length}));
