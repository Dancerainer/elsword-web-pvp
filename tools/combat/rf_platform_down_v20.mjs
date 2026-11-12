import {mkdirSync,writeFileSync} from 'node:fs';
import {runPlatform} from '../../tests/helpers/platform-down-v20-fixture.mjs';
const out=process.argv[2]??'artifacts/proof-platform-down-v20';mkdirSync(out,{recursive:true});
const cases=[];
for(const facing of [-1,1])for(const back of [false,true])for(const pickup of [false,true]){
  const {s,timeline,frames,reactions}=runPlatform({facing,back,pickup});
  const id=`${facing<0?'left':'right'}-${back?'back':'front'}-${pickup?'pickup':'landing'}`;
  const filename=id+'.json';writeFileSync(out+'/'+filename,JSON.stringify({timeline,frames,reactions})+'\n');
  const first=frames.findIndex(f=>f.target.state==='RSI_DAMAGE_AIR_FALL');
  const landed=frames.findIndex(f=>f.target.grounded&&f.target.y===3560);
  cases.push({id,frames:frames.length,initialHitState:reactions[0]?.after.state,fallFrame:first,fallAnimation:first<0?null:frames[first].target.animationName,
    firstLowerLandFrame:landed,pickupReaction:reactions.find(r=>r.attacker==='pickup')?.after.state??null,
    finalState:s.actor('target').state,trace:filename});
}
const report={schema:'rf-platform-down-observation-v20',evidenceClass:'current-simulation-inputs-not-original2016',
  candidateHook:process.env.RF_PLATFORM_DOWN_CANDIDATE_HOOK==='1',target2016ClientMeasured:false,gpuVerified:false,
  originalGeometrySourceSha256:'dc51d7927c168a57e6220796b6c73cc90104abdcb39723c9c4d24b7dd7c57d8a',cases};
writeFileSync(out+'/summary.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
