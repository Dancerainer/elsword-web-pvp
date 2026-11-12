/** Current implementation observations, never an original-client oracle. */
import {writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {addFixture} from '../../tests/helpers/add-fixture.mjs';
import {PROFESSION_PROFILES,PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {loadAddSummonAssets} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
import {startAddFormation} from '../../packages/combat-core/add-systems.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
const poses=process.argv.includes('--poses'),read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const report={schemaVersion:1,evidenceClass:'current-web-simulation-observation',originalClientMeasured:false,
  nativePoses:poses,conditions:'Production presets and source WASM, authored Garpai map. Full MP/DP/6 mutation seeded for each isolated skill. No cooldown bypass during cast. Holding key for 1 second then releasing.',professions:{}};
report.sourceFiles=Object.fromEntries(['packages/combat-core','packages/combat-assets','packages/native-source','packages/professions','config'].flatMap(dir=>
 readdirSync(new URL('../../'+dir+'/',import.meta.url)).filter(n=>n.endsWith('.mjs')||/^(lp|mm|de)-(profile|preset)\.json$/.test(n)).map(n=>dir+'/'+n))
 .map(file=>[file,createHash('sha256').update(readFileSync(new URL('../../'+file,import.meta.url)).toString('utf8').replaceAll('\r\n','\n')).digest('hex')]));
report.sourceHashNormalization='UTF-8 LF; current implementation provenance, not original-client expected output';
for(const file of ['tests/helpers/add-fixture.mjs','artifacts/common-buffs/catalog.json'])
 report.sourceFiles[file]=createHash('sha256').update(readFileSync(new URL('../../'+file,import.meta.url)).toString('utf8').replaceAll('\r\n','\n')).digest('hex');
let failures=0,sourceBlocked=0;
for(const id of ['LP','MM','DE']){
 const profile=PROFESSION_PROFILES[id],base='artifacts/'+id.toLowerCase()+'/',samplers={};
 if(poses){
  const manifest=read(base+'manifest.json'),raw=read(base+manifest.runtimePose),characterPose=composeCharacterPose(raw,raw.sharedPose?read(base+raw.sharedPose):null);
  const summon=id==='MM'?await loadAddSummonAssets({base:'mm/',data:file=>read('artifacts/'+file),profile}):null;
  const effectIndex=mergeEffectIndexes(read(base+manifest.effectAssetIndex),mergeVisualEffectIndexes(...manifest.visualEffectIndexes.map(file=>read(base+file)),...(summon?[summon.fxIndex]:[])));
  const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(file=>[file,read(base+file)]));
  Object.assign(samplers,createNativeSamplers({profile,characterPose,effectIndex,effectPoses}));
  if(summon)Object.assign(samplers,createAddSummonSamplers(summon));
 }
 const rows=[];report.professions[id]=rows;
 for(const skill of profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900))for(const formation of [false,true]){
  const row={skillId:skill.skillId,formation,supported:skill.supported,missingAnimationStates:skill.missingAnimationStates??[]};rows.push(row);
  try{
   const {sim,a,b}=addFixture(id,{skillId:skill.skillId,passives:PROFESSION_PRESETS[id].passives,samplers});a.sourceAdd.dp=8000;a.sourceAdd.mutation=6;b.hp=b.hpMax=1e8;
   if(formation)startAddFormation(a,{profile:sim.profileFor(a)});
   const gate=sim.skillAvailability(a.id,0);row.gate={available:gate.available,reason:gate.reason,mode:gate.mode};
   const states=new Set(),effects=new Set();let hits=0,started=0;
   for(let frame=0;frame<60*12;frame++){
    sim.step(1/60,{add:{pressed:frame===0?['A']:[],held:frame<60?['A']:[]}}, {snapshot:false});states.add(a.state);
    for(const e of sim.drainEvents()){if(e.type==='hit')hits++;if(e.type==='skillStarted')started++;if(e.type==='effectSet')effects.add(e.name);}
   }
   row.started=started;row.states=[...states];row.effectSets=[...effects];row.hits=hits;
   row.finalState=a.state;row.finalSkillId=a.skillId;row.remainingEffects=sim.state.effects.length;
   row.unsupported=[...sim.state.unsupported,...a.unsupported,...b.unsupported].filter(n=>!['fidelity-unverified','native-helper-adapter-missing','native-effect-adapter-missing','native-defender-adapter-missing'].includes(n.id));
   if(gate.available&&started!==1){row.error='Accepted input did not start exactly one skill';failures++;}
  }catch(error){
   if([29016,29018,29021].includes(skill.skillId)&&skill.supported===false&&error instanceof RangeError&&error.message===`Skill ${skill.skillId} executor is unimplemented`){
    row.sourceBlocked=true;row.rejection=error.message;sourceBlocked++;
   }else{row.error=error.stack;failures++;}
  }
 }
 console.log(id+': '+rows.length+' cast modes observed');
}
const reportFile=process.argv.includes('--report')?process.argv[process.argv.indexOf('--report')+1]:'reports/add-runtime-observation-v1.json';
if(!reportFile||reportFile.startsWith('/')||reportFile.includes(':')||reportFile.split(/[\\/]/).includes('..'))throw new TypeError('Task-relative report path required');
report.failures=failures;report.sourceBlocked=sourceBlocked;writeFileSync(new URL('../../'+reportFile,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('Runtime exceptions / accepted-input failures: '+failures);if(failures)process.exitCode=1;
