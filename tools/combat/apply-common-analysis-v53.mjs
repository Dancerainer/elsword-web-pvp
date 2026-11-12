/** Refresh implementation metadata while retaining original raw JSON bytes. */
import fs from 'node:fs';
import path from 'node:path';
import {updateAddProfileText} from './add-profile-text.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const adopted=new Set(['MI_USEFUL','MI_LONGSHOT']);
for(const id of ['rf','lk','rs','is','bm','vc','gm','bh','ca','lp','mm','de']){
 const file=path.join(root,'packages/combat-core/'+id+'-profile.json'),text=fs.readFileSync(file,'utf8'),profile=JSON.parse(text);
 for(const skill of profile.skillCatalog){
  for(const branch of skill.branches??[])if(adopted.has(branch.memoTypeName)){
   branch.supported=true;branch.supportStatus='target2016-static-public-DD-consumer-v53';
   branch.limitations=(branch.limitations??[]).filter(row=>!['additional-hit-count','longshot-range'].includes(String(row.key??row).split(':')[0]));
  }
  if(id==='lk'&&skill.skillId===21010)skill.limitations=(skill.limitations??[]).filter(row=>String(row.key??row).split(':')[0]!=='hold-extension');
 }
 fs.writeFileSync(file,updateAddProfileText(text,profile));
}
const random=path.join(root,'packages/combat-core/add-random-table-2016.mjs');
let text=fs.readFileSync(random,'utf8');
const begin=text.indexOf('const bytes='),end=text.indexOf('export function',begin);
if(begin>=0){
 if(end<begin)throw Error('Missing original Add random wrapper');
 text=text.slice(0,begin)+"import {sourceOriginalRandomWord2016} from './source-random-table-v53.mjs';\n"+text.slice(end);
 text=text.replace('value=bytes[2*n]+bytes[2*n+1]*256','value=sourceOriginalRandomWord2016(n)');
 fs.writeFileSync(random,text);
}
const wire=path.join(root,'packages/online/owned-state.mjs');
text=fs.readFileSync(wire,'utf8');
text=text.replace("'animationSpeedMultiplier','accuracy','enchantAttackRate'","'animationSpeedMultiplier','accuracy','avoidance','enchantAttackRate'");
fs.writeFileSync(wire,text);
console.log(JSON.stringify({profiles:12,sharedOriginalRandomTable:true,rawDeclarationsRewritten:false}));
