/** Source-field audit. This records a web display decision, never native gold. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),assets=resolve(process.argv[2]??resolve(root,'artifacts'));
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const shared=new Set();
for(const id of ['rf','lk','bm','rs','vc','is']){
  const index=await read(resolve(root,`artifacts/${id}/fx/index.json`));
  for(const name of Object.keys(index.templates))shared.add(name);
}
const cues=new Map(),sources={};
for(const id of ['gm','bh','ca']){
  const file=await readFile(resolve(assets,`${id}/fx/index.json`));
  sources[id]={sha256:createHash('sha256').update(file).digest('hex')};
  const index=JSON.parse(file);
  for(const template of Object.values(index.templates)){
    const {name,kind,fields:f}=template;
    if(kind!=='particle'||shared.has(name)||!(f.NumParticles>1)||f.TriggerCount===1)continue;
    const rate=f.Emitrate,time=f.TriggerTime;
    const sparse=f.NumParticles<=4;
    const short=typeof rate==='number'&&rate>0&&typeof time==='number'&&time>0&&time*rate<=8&&time<8/rate;
    if(!sparse&&!short)continue;
    const row=cues.get(name)??{name,professions:[],source:{particleType:f.particleType,Emitrate:rate,NumParticles:f.NumParticles,
      ...(time===undefined?{}:{TriggerTime:time}),...(f.TriggerCount===undefined?{}:{TriggerCount:f.TriggerCount})},
      reason:sparse?'at most four simultaneous structural particles':'at most eight authored births; /8 can erase the entire short packet'};
    row.professions.push(id.toUpperCase());cues.set(name,row);
  }
}
const contract={schemaVersion:1,evidenceClass:'target2016-static-fields-and-web-display-policy',targetClientMeasured:false,
  policy:'Keep source emission clock and capacity for these sparse/short Elesis layers. Dense fields retain selected web density; high remains source density.',
  sourceIndexes:sources,cues:[...cues.values()].sort((a,b)=>a.name.localeCompare(b.name))};
await writeFile(resolve(root,'contracts/elesis-effect-density-v1.json'),JSON.stringify(contract,null,2)+'\n');
console.log(JSON.stringify({preservedCues:contract.cues.length,sources}));
