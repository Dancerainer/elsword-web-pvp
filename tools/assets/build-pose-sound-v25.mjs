import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const read=p=>JSON.parse(readFileSync(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const declaration=read('.cache/pvp-source/target2016/RAVEN_FIGHTER.json');
if(sha(readFileSync(declaration.source.path))!==declaration.source.sha256)throw Error('RF source hash changed');
const poses=read('contracts/rf-pvp-rules-source-v1.json').poses,states={};
for(const kind of ['start','win','lose'])for(const pose of poses[kind]){
 const raw=declaration.globals[pose.state];if(!raw)throw Error('Missing original RF pose '+pose.state);
 states[pose.state]=Object.fromEntries(Object.entries(raw).filter(([key])=>key==='ANIM_SPEED'||/^SOUND_PLAY\d+$/.test(key)));
}
writeFileSync('contracts/rf-pose-sounds-v25.json',JSON.stringify({evidenceClass:'target2016-static-declarations',originalClientMeasured:false,source:declaration.source,states},null,2)+'\n');
const audio=read('artifacts/audio/manifest.json'),required=new Set(Object.values(states).flatMap(raw=>Object.entries(raw).filter(([k])=>k.startsWith('SOUND_PLAY')).map(([,v])=>v['2'])));
const copied=[],addon={schemaVersion:1,files:{}};
const catalog=new DatabaseSync('asset_work/catalog.sqlite',{readOnly:true});
for(const name of required){
 if(audio.files[name])continue;
 const candidates=catalog.prepare("SELECT raw_path,sha256 FROM assets WHERE status='ok' AND name=? COLLATE NOCASE ORDER BY archive,ordinal").all(name);
 if(!candidates.length||new Set(candidates.map(r=>r.sha256)).size!==1)throw Error('Ambiguous original sound '+name);
 const source=resolve('asset_work',candidates[0].raw_path),bytes=readFileSync(source);
 if(sha(bytes)!==candidates[0].sha256)throw Error('Original sound hash mismatch '+name);
 if(bytes.subarray(0,4).toString()!=='OggS')throw Error('Original Ogg missing '+name);
 const hash=sha(bytes),file='pose-v25/'+name;mkdirSync('artifacts/audio/pose-v25',{recursive:true});copyFileSync(source,'artifacts/audio/'+file);
 addon.files[name]={file,sha256:hash,bytes:bytes.length,source};copied.push(addon.files[name]);
}
catalog.close();
writeFileSync('artifacts/audio/pose-v25/manifest.json',JSON.stringify(addon,null,2)+'\n');
writeFileSync('contracts/pose-audio-assets-v25.json',JSON.stringify({evidenceClass:'target2016-original-resource',originalClientMeasured:false,files:copied},null,2)+'\n');
console.log(JSON.stringify({poseStates:Object.keys(states).length,requiredSounds:required.size,copied}));
