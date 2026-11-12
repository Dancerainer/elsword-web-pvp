/** Sequential baseline/current positive-dt playback A/B. Run through the
 * bounded runner. Each side gets its own short-lived Native process; the
 * summarizer itself imports no combat runtime. This is a v1/JSON fault model,
 * not a binary transport, browser, bandwidth or original-client benchmark. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const thisFile=fileURLToPath(import.meta.url),project=resolve(dirname(thisFile),'../..');
import {resolveBaselineCommit} from '../baseline-ref.mjs';
const measureFile='tools/validation/measure-network-teleports-v34.mjs';
const scenarios=['stall-1300','spike-300','spike-650','lan','fixed-rtt-80','fixed-rtt-160','jitter-rtt-80','jitter-loss-1pct'];
const workloads=['dash','air-command','platform'],expectedKeys=scenarios.flatMap(name=>workloads.map(workload=>name+'/'+workload));
const sourceFields=['ownerX','ownerY','ownerHp','ownerState','ownerSerial','ownerTime','ownerLine'];
const receiverFields=['admitted','played','starts','duplicates','lateOrder','expired','rejected','overflowed','pending',
  'phaseMismatches','maxSchedulingDelayFrames','invalidatedCorrections','motionRecoveries','budgetRotations'];
const metricFields=['positionErrorP95','maximumCorrection','contrarySteps','steadyVelocityErrorP95','steadyVelocitySamples'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const jsonHash=value=>hash(JSON.stringify(canonical(value)));
const save=(file,value)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const key=row=>row.scenario.name+'/'+row.workload;
const pick=(value,fields)=>Object.fromEntries(fields.map(field=>[field,value?.[field]??null]));
const metric=(before,after)=>({before,after,delta:after-before,changePercent:before===0?null:(after-before)/before*100});
const expectedFault=(scenario,fault)=>['stall-1300','spike-650'].includes(scenario)
  &&['control-pose-timeout','control-ack-timeout'].includes(fault.reason);
function failure(check,actual,expected){return {check,actual,expected};}

function ownerSummary(row,owner){
  const final=owner.final,receiver=owner.receiver?.receiver??{},control=owner.control??{};
  const checks={finalHp:final.ownerHp===final.observedHp,finalState:final.ownerState===final.observedState,
    finalY:final.ownerY===final.observedY,finalLine:final.ownerLine===final.observedLine,
    finalX:Number.isFinite(final.error)&&final.error<=.001,playbackQueue:receiver.pending===0,
    reliableQueue:control.pendingPackets===0&&control.inflightPackets===0,
    receiverQueue:control.pendingReceive===0,poseFence:control.pendingPoses===0};
  return {id:owner.id,ownerTrajectorySha256:jsonHash(row.trace.map(tick=>[tick.frame,...sourceFields.map(field=>tick[owner.id][field])])),
    reports:owner.reports,actions:owner.actions,hits:owner.hits,hitCount:owner.hitCount,damageTaken:owner.damageTaken,final,
    metrics:pick(owner,metricFields),lineTransitions:owner.lineTransitions,receiver:pick(receiver,receiverFields),
    control:pick(control,['pendingPackets','inflightPackets','pendingReceive','pendingPoses','failed','degraded']),
    absoluteChecks:checks,absoluteFailures:Object.entries(checks).filter(([,ok])=>!ok).map(([check])=>check)};
}

/** Pure report comparison, also usable to re-summarize saved evidence without
 * launching Native. Existing baseline failures are recorded, never assumed. */
export function comparePlaybackReports(before,after){
  const rows=[],invariants=[],absoluteFailures={baseline:[],candidate:[]},regressions=[];
  const beforeRows=before.rows??[],afterRows=after.rows??[],bIndex=new Map(beforeRows.map(row=>[key(row),row])),aIndex=new Map(afterRows.map(row=>[key(row),row]));
  for(const [side,list,index]of [['baseline',beforeRows,bIndex],['candidate',afterRows,aIndex]]){
    if(list.length!==24||index.size!==24||!expectedKeys.every(name=>index.has(name)))
      invariants.push(failure(side+'MatrixCases',[...index.keys()],expectedKeys));
  }
  if(!equal(before.assetHashes,after.assetHashes))invariants.push(failure('assetHashes',after.assetHashes,before.assetHashes));
  for(const name of expectedKeys){
    const b=bIndex.get(name),a=aIndex.get(name);if(!b||!a)continue;
    const pairFailures=[];
    for(const field of ['scenario','workload','frames','seed','controlHeaders','inputSha256'])if(!equal(b[field],a[field]))
      pairFailures.push(failure(field,a[field],b[field]));
    for(const [side,value]of [['baseline',b],['candidate',a]])for(const [field,want]of [['frames',660],['seed',20161014],['controlHeaders',true]])
      if(value[field]!==want)pairFailures.push(failure(side+':'+field,value[field],want));
    if(!equal(b.owners.map(owner=>owner.id).sort(),a.owners.map(owner=>owner.id).sort()))pairFailures.push(failure('ownerIds',a.owners.map(x=>x.id),b.owners.map(x=>x.id)));
    const owners=[];
    for(const rawBefore of b.owners){
      const rawAfter=a.owners.find(owner=>owner.id===rawBefore.id);if(!rawAfter)continue;
      const previous=ownerSummary(b,rawBefore),current=ownerSummary(a,rawAfter),ownerRegressions=[];
      for(const field of ['ownerTrajectorySha256','actions','hits','hitCount','damageTaken'])if(!equal(previous[field],current[field]))
        pairFailures.push({owner:rawBefore.id,...failure(field,current[field],previous[field])});
      for(const [side,value]of [['baseline',previous],['candidate',current]])for(const check of value.absoluteFailures)
        absoluteFailures[side].push({case:name,owner:value.id,check,final:value.final,
          queues:{playback:value.receiver.pending,...value.control}});
      for(const check of current.absoluteFailures)if(previous.absoluteChecks[check])ownerRegressions.push('new-absolute-failure:'+check);
      if(!current.absoluteChecks.finalX&&!previous.absoluteChecks.finalX&&current.final.error>previous.final.error+.001)
        ownerRegressions.push('existing-finalX-error-worsened');
      for(const field of ['rejected','overflowed'])if(current.receiver[field]>previous.receiver[field])ownerRegressions.push('increased-'+field);
      if(ownerRegressions.length)regressions.push({case:name,owner:current.id,reasons:ownerRegressions});
      owners.push({id:current.id,baseline:previous,candidate:current,
        metricChanges:Object.fromEntries(metricFields.map(field=>[field,metric(previous.metrics[field],current.metrics[field])])),
        receiverChanges:Object.fromEntries(receiverFields.map(field=>[field,metric(previous.receiver[field]??0,current.receiver[field]??0)])),regressions:ownerRegressions});
    }
    const faultKey=fault=>fault.from+':'+fault.reason,counts=list=>list.reduce((out,fault)=>{out[faultKey(fault)]=(out[faultKey(fault)]??0)+1;return out;},{});
    const oldCounts=counts(b.faults),newCounts=counts(a.faults),increasedFaults=Object.entries(newCounts).filter(([id,count])=>count>(oldCounts[id]??0));
    for(const [side,value]of [['baseline',b],['candidate',a]])for(const fault of value.faults)if(!expectedFault(value.scenario.name,fault))
      absoluteFailures[side].push({case:name,check:'unexpected-fault',fault});
    if(increasedFaults.length)regressions.push({case:name,reasons:['increased-control-faults'],counts:increasedFaults});
    invariants.push(...pairFailures.map(item=>({case:name,...item})));
    rows.push({scenario:b.scenario,workload:b.workload,frames:b.frames,seed:b.seed,controlHeaders:b.controlHeaders,inputSha256:b.inputSha256,
      invariantFailures:pairFailures,owners,
      faults:{baseline:b.faults,candidate:a.faults,timelineEqual:equal(b.faults,a.faults),increasedFaults,
        expectedExtremeStall:['stall-1300','spike-650'].includes(b.scenario.name)},
      applicationModelCounters:{baseline:b.wire,candidate:a.wire,
        scope:'Uncompressed JSON model counters only; these do not measure binary, gzip, SCTP or production bandwidth savings.'}});
  }
  const comparisonPassed=invariants.length===0&&regressions.length===0;
  return {schemaVersion:1,status:!comparisonPassed?'regression':absoluteFailures.candidate.length?'existing-absolute-failures'
      :absoluteFailures.baseline.length?'baseline-existing-failures':'passed',comparisonPassed,
    aggregate:{cases:rows.length,ownerComparisons:rows.reduce((sum,row)=>sum+row.owners.length,0),
      identicalInputAndOwnedTrajectories:rows.length===24&&!invariants.some(row=>['inputSha256','ownerTrajectorySha256','baselineMatrixCases','candidateMatrixCases','ownerIds'].includes(row.check)),
      absolutePass:{baseline:absoluteFailures.baseline.length===0,candidate:absoluteFailures.candidate.length===0},
      baselineFaults:beforeRows.reduce((n,row)=>n+row.faults.length,0),candidateFaults:afterRows.reduce((n,row)=>n+row.faults.length,0),
      maximumFinalPositionError:{baseline:Math.max(0,...beforeRows.flatMap(row=>row.owners.map(owner=>owner.final.error))),
        candidate:Math.max(0,...afterRows.flatMap(row=>row.owners.map(owner=>owner.final.error)))},invariantFailures:invariants.length,regressions:regressions.length},
    invariantFailures:invariants,absoluteFailures,regressions,rows};
}

function sourceSeal(root){
  const files=new Set(),visit=file=>{
    if(files.has(file)||!existsSync(resolve(root,file)))return;files.add(file);
    if(!file.endsWith('.mjs'))return;
    const text=readFileSync(resolve(root,file),'utf8');
    // Static relative ESM dependencies, including literal dynamic imports.
    for(const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)(['"])(\.[^'"]+)\1/g)){
      const dependency=relative(root,resolve(root,dirname(file),match[2])).replaceAll('\\','/');
      if(!dependency.startsWith('../'))visit(dependency);
    }
  };
  visit(measureFile);
  for(const id of ['rf','lp','de'])for(const file of ['packages/combat-core/'+id+'-profile.json','config/'+id+'-preset.json'])visit(file);
  if(existsSync(resolve(root,'package-lock.json')))visit('package-lock.json');
  return Object.fromEntries([...files].sort().map(file=>[file,hash(readFileSync(resolve(root,file)))]));
}
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
function metadata(root){return {root:realpathSync(root),commit:git(root,'rev-parse','HEAD'),sourceHashes:sourceSeal(root),
  trackedChanges:git(root,'status','--porcelain','--untracked-files=no')};}

async function measureChild(root,output,assetRoot){
  const started=performance.now(),cpu=process.cpuUsage();
  try{
    const {measureNetworkTeleports}=await import(pathToFileURL(resolve(root,measureFile)).href);
    const result=await measureNetworkTeleports({assetRoot,frames:660,controlHeaders:true});
    const used=process.cpuUsage(cpu);result.comparisonRun={root,frames:660,controlHeaders:true,
      elapsedWallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000,memoryAfter:process.memoryUsage()};save(output,result);
    console.log(JSON.stringify({sideRoot:root,output,rows:result.rows.length,status:'measured'}));
  }catch(error){save(output,{status:'measurement-failed',root,error:{message:error.message,stack:error.stack},
    elapsedWallMs:performance.now()-started,partialRowsAvailable:false});process.exitCode=1;}
}

async function main(){
  if(process.argv[2]==='--measure-child'){await measureChild(...process.argv.slice(3,6));return;}
  const output=resolve(project,process.argv[2]??'runtime/network2016-playback-comparison.json'),stem=output.replace(/\.json$/i,'');
  const roots={baseline:resolve(process.env.RF_NETWORK2016_BASELINE_ROOT??'.cache/comparison-source'),
    candidate:resolve(process.env.RF_NETWORK2016_CANDIDATE_ROOT??project)};
  const assetRoot=realpathSync(resolve(process.env.RF_NETWORK2016_ASSET_ROOT??resolve(roots.candidate,'artifacts')));
  const implementations=Object.fromEntries(Object.entries(roots).map(([side,root])=>[side,metadata(root)]));
  if(implementations.baseline.commit!==resolveBaselineCommit(roots.baseline))throw Error('Baseline checkout must match WEB_PVP_BASELINE_REF');
  if(implementations.baseline.trackedChanges)throw Error('baseline tracked files must remain clean');
  const started=performance.now(),base={createdAt:new Date().toISOString(),evidenceClass:'current-web-native-playback-fault-model-ab',
    targetClientMeasured:false,assetRoot,implementations,tool:{path:thisFile,sha256:hash(readFileSync(thisFile))},
    sourceSealScope:'Static relative ESM dependency closure, RF/LP/DE profiles and presets, package lock; actual runtime assets sealed by each measurement.',
    limitations:['The unchanged matrix uses default pose v1, JSON stringify/parse, deterministic ordered loss/retry/HOL and modeled relay. It does not exercise online-client binary negotiation or encode network binary.',
      'Position/correction metrics are source map units, not pixels or measured network latency. Lower corrections may trade against greater temporary position lag; no universal improvement is assumed.',
      'Separate side processes each load their own Native runtime and execute sequentially. Wall/CPU totals include fixture loading and controlled simulation, not browser FPS.',
      'The default three inputs separate participants; matching HP/hit totals are not proof of close-range collision behavior.',
      'Receiver order counters are retained, including existing lateOrder/expired results. Full canonical action-ID ordering is covered by separate unit/integration and wire measurements.',
      '650/1300 ms stalls may retain control-pose/ack timeouts and recover through modeled relay. All fault timestamps, reasons and pose-baseline misses remain visible.',
      'No original 2016 client, browser GPU, actual WebRTC/HTTP worker, WAN or real bandwidth capacity is measured.'],rawReports:{}};
  save(output,{...base,status:'running'});
  const raw={},errors=[];
  for(const side of ['baseline','candidate']){
    const file=stem+'-'+side+'-raw.json';console.log(JSON.stringify({stage:'start',side,root:roots[side],frames:660,cases:24}));
    const child=spawnSync(process.execPath,[thisFile,'--measure-child',roots[side],file,assetRoot],{cwd:roots[side],stdio:['ignore','inherit','inherit'],windowsHide:true});
    if(existsSync(file)){raw[side]=JSON.parse(readFileSync(file));base.rawReports[side]={path:file,sha256:hash(readFileSync(file)),processExitCode:child.status};}
    if(child.error||child.status!==0||!Array.isArray(raw[side]?.rows))errors.push({side,message:child.error?.message??raw[side]?.error?.message??'measurement process failed',processExitCode:child.status});
  }
  for(const side of ['baseline','candidate']){
    const final=metadata(roots[side]);if(final.commit!==implementations[side].commit||!equal(final.sourceHashes,implementations[side].sourceHashes))
      errors.push({side,message:'source changed during measurement',final});
  }
  if(hash(readFileSync(thisFile))!==base.tool.sha256)errors.push({message:'comparison tool changed during measurement'});
  const comparison=errors.length?{status:'measurement-failed',errors}:comparePlaybackReports(raw.baseline,raw.candidate);
  const result={...base,...comparison,elapsedWallMs:performance.now()-started};save(output,result);
  // Exit 2 means measurements completed but an absolute criterion failed on
  // at least one side. Their relative comparison may still have passed.
  process.exitCode=errors.length||comparison.comparisonPassed===false?1:
    !comparison.aggregate.absolutePass.baseline||!comparison.aggregate.absolutePass.candidate?2:0;
  console.log(JSON.stringify({output,status:result.status,aggregate:result.aggregate,exitCode:process.exitCode,sha256:hash(readFileSync(output))}));
}
if(process.argv[1]&&resolve(process.argv[1])===thisFile)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
