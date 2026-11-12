import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),source='asset_sources/analysis-project';
const docs=['MM_COMMAND_FURY_PRODUCER_2016','MM_INSTALL_FURY_MUTATION_2016','ADD_ENERGY_BOOM_MUTATION_2016','LP_STASIS_FIELD_2016','LP_CONQUEROR_SCATTER_2016','LP_MAGNETRON_PRODUCER_2016','MM_DRONE_ACTIVATOR_2016','DE_LOCAL_SKILL_CONSUMERS_2016','STARDUST_TERMINAL_2016','STARDUST_GEOMETRY_2016'];
docs.push('DE_VOID_FIELD_TERMINAL_2016','DE_SPACE_CRACK_PRODUCER_2016','MM_DYNAMO_GUIDANCE_2016','ADD_PRISM_CONSUMERS_2016','PRISM_SCRIPT_VM_2016','PRISM_RANGE_SLICE_2016','PRISM_FIELD_DEATH_2016','PRISM_GROUP_LIFETIME_2016','DE_PREDICTION_CONSUMERS_2016','DE_PHYSICS_CLOSURE_2016','ADD_AWAKE_STATE_PRODUCER_PASS2_2016','ADD_AWAKENING_CONTROLLER_2016','SKILL_SOCKET_MODIFIER_PRODUCTION_2016','ADD_PARTICLE_SHOT_2016');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),rows=[];
const target=path.join(root,'contracts/add-analysis-v53');fs.mkdirSync(target,{recursive:true});
for(const name of docs){
 const sourcePath='docs/'+name+'.md',body=fs.readFileSync(path.join(source,sourcePath)),file=path.join(target,name+'.md');fs.writeFileSync(file,body);
 rows.push({sourcePath,local:path.relative(root,file).replaceAll('\\','/'),sha256:sha(body)});
}
const output={schemaVersion:1,scope:'ADD adopted target2016 consumer waves1/2; no Maximum changes',sourceRepository:source,sourceGit:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 sourceOriginalSha256:'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',sourceDerivedSha256:'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba',
 evidenceClass:'original2016 declarations and static native conditional algorithms; inherited non-atomic startup capture; no target execution or client combat measurement',targetExecuted:false,V5UsedForNewBehavior:false,rows,
 boundaries:['Web deterministic low16 simulation seed supplies Conqueror instance seed; original battle distribution was not measured','Original Conqueror Hyper main skill9009 runtime modifier input unavailable, base main scalar explicitly retained','Actor candidate lists and map-basis Euler scan are Web adapters; original typed NPC/companion containers are not claimed implemented','Original Stasis wrapped-damage value and current Web accepted-damage observation phase remain separately qualified','No pixel1:1, original dynamic battle trajectory, WAN or universal outcome claim'],
 remainingIntegration:['DE complete2016 PhysicProcess bridge with all persistent typed-object side effects; eight-step orchestration is implemented and never replaced by a linear teleport','Prism original NPC collision/defence-stat and independent motion host; endpoint domain and correct group lifetime are implemented','Original MM additional retarget delay/compensation branches beyond implemented exact selected mode1/3 selector/history gates','Full socket producer equipment/source maps beyond the adopted exact per-skill query','Conqueror Hyper skill9009 main modifier actual input'],
 productInputs:['Ordinary Web playable actors explicitly supply original6d7e predicate0, independent offormation, not original battle heap evidence','Space Crack writable global cost uses sealed capture value60 as frozen Web rule input','Prism endpoint fixed simulation timeline supplies reproducible wallclock input; no real-world original clock observation']};
fs.writeFileSync(path.join(root,'contracts/add-analysis-v53-source.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({sourceGit:output.sourceGit,docs:rows.length}));
