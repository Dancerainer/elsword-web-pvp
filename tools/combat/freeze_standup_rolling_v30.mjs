import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [declarations,assets]=process.argv.slice(2).map(p=>resolve(p));
const sha=b=>createHash('sha256').update(b).digest('hex'),read=async p=>JSON.parse(await readFile(p,'utf8'));
const classes={raven:[107,106,115],elsword:[100,101,112]},baseJobs={raven:'rf',elsword:'lk'},result={schemaVersion:1,targetClientMeasured:false,classes,states:{},sources:{}};
for(const kind of Object.keys(classes)){
 const source=await read(resolve(declarations,kind+'-declarations.json'));
 if(sha(await readFile(source.source.path))!==source.source.sha256)throw Error('Original unit source changed');
 const poseFile=resolve(assets,baseJobs[kind],'runtime-pose.json'),bytes=await readFile(poseFile),pose=JSON.parse(bytes);
 result.sources[kind]={...source.source,poseFile:baseJobs[kind]+'/runtime-pose.json',poseSha256:sha(bytes),evidenceClass:'original2016 static unit + previously D3DX-converted source keys; no original-client run'};
 result.states[kind]={};
 for(const [name,raw]of Object.entries(source.globals).filter(([n])=>n.includes('_STANDUP_ROLLING_'))){
  const clip=pose.clips.find(c=>c.name===raw.ANIM_NAME);if(!clip)throw Error('Original rolling clip absent: '+name);
  result.states[kind][name]={raw,sourceState:name,sourcePc:source.locations[name],animationName:raw.ANIM_NAME,
   clip:{durationSeconds:clip.durationSeconds,durationTicks:Math.round(clip.durationSeconds*clip.ticks_per_second),ticksPerSecond:clip.ticks_per_second,
     sourceName:clip.name,decodedKeysSha256:sha(JSON.stringify(clip.tracks))},validation:result.sources[kind].evidenceClass};
 }
 if(Object.keys(result.states[kind]).length!==4)throw Error('Original four rolling states required');
}
await writeFile('contracts/standup-rolling-source-v30.json',JSON.stringify(result,null,2)+'\n');
