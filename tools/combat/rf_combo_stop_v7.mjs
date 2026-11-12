/** Production native modules, source pose helpers and authored Garpai collision.
 * The traces are current simulation observations, never target-client goldens.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>JSON.parse(readFileSync(resolve(project,path)));
export const comboStopProfile=read('packages/combat-core/rf-profile.json');
const preset=read('config/rf-preset.json'),manifest=read('artifacts/native/manifest.json');
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json')};
const visual=mergeVisualEffectIndexes(...['rf-fx-index.json','rf-buff-display-fx-index.json','rf-shadow-weapon-fx-index.json',
  'rf-awakening-fx-index.json','rf-command-fx-index-v9.json','rf-skill-fx-index-v11.json','rf-core-shield-fx-index-v11.json',
  'rf-critical-fx-index-v11.json','rf-xx2x-fx-index-v12.json'].map(name=>read('contracts/'+name)));
const effectIndex=mergeEffectIndexes(read('artifacts/rf/effect-assets.json'),visual);
const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(template=>template.poseData).filter(Boolean))]
  .map(path=>[path,read('artifacts/rf/'+path)]));
const samplers=createNativeSamplers({profile:comboStopProfile,characterPose:read('artifacts/rf/runtime-pose.json'),effectIndex,effectPoses});
export async function comboStopFixture({facing=1,corner=false,hit=true,gap=70,speed=1.4,adaptation=true,passives=preset.passives}={}){
  const n=await createNativeRuntime({manifest,map,loadBinary:path=>readFileSync(resolve(project,'artifacts/native',path))});
  const position=corner?[facing*2060,2840,0]:[0,3080,0],lineId=corner?(facing===1?6:0):2;
  const target=hit?[position[0]+facing*gap,position[1],0]:corner?[0,3080,0]:[facing*1500,3080,0];
  const p={...preset,sampledComboStopLatch:adaptation,passives,attributes:{...preset.attributes,animationSpeedMultiplier:speed}};
  const s=createSimulation({profile:comboStopProfile,map,preset:p,seed:2016,
    actors:[{id:'rf',team:0,position,lineId,facing},{id:'target',team:1,position:target,lineId:hit?lineId:2,facing:-facing}],
    ...samplers,nativeGeometry:n.geometry,nativeCommands:n.commands,nativeSkills:n.skills,nativeSkillValues:n.skillValues,
    nativeNasod:n.nasod,nativeCritical:n.critical,nativeManaBreak:n.manaBreak,versions:n.versions});
  return {s,a:s.actor('rf'),b:s.actor('target'),n};
}
export const comboStopFrame=(fixture,input={})=>fixture.s.step(1/60,input,{snapshot:false});
export async function observeComboStopV7({facing=1,corner=false,hit=true,speed=1.4,interval=15,dashFirst=false,adaptation=true,frames=130,key='X'}={}){
  const fixture={facing,corner,hit,speed,interval,dashFirst,adaptation,frames,key};
  const f=await comboStopFixture(fixture),buffer=createInputBuffer({sampledLevels:true}),samples=[],packets=[];
  const forward=facing===1?'RIGHT':'LEFT';buffer.down(forward,.001);
  const firstAttack=dashFirst?4:1;
  if(dashFirst){buffer.up(forward,.02);buffer.down(forward,.04);}
  for(let i=1;i<=frames;i++){
    if(i>=firstAttack&&(i-firstAttack)%interval===0)buffer.down(key,(i-.5)/60);
    if(i>=firstAttack&&(i-firstAttack)%interval===2)buffer.up(key,(i-.5)/60);
    const packet=buffer.consume(i/60),before={state:f.a.state,stateSerial:f.a.stateSerial,animationTime:f.a.animationTime,
      hitStop:f.a.hitStop,worldStop:f.a.worldStop,sourceCommandFlags:f.a.sourceCommandFlags};
    packets.push(packet);comboStopFrame(f,packet);
    samples.push({step:i,packet,before,state:f.a.state,stateSerial:f.a.stateSerial,animationTime:f.a.animationTime,
      hitStop:f.a.hitStop,flags:f.a.sourceCommandFlags,latch:f.a.comboStopInput?{...f.a.comboStopInput}:null,
      facing:f.a.facing,grounded:f.a.grounded,position:[f.a.x,f.a.y,f.a.z],targetPosition:[f.b.x,f.b.y,f.b.z]});
  }
  const events=f.s.drainEvents(),stateChanges=events.filter(event=>event.type==='stateChanged'&&event.actorId==='rf');
  const hits=events.filter(event=>event.type==='hit'&&event.actorId==='rf');
  const latched=events.filter(event=>event.type==='comboStopInputLatched'),replayed=events.filter(event=>event.type==='comboStopInputReplayed');
  const summary={fixture,versions:f.s.versions,states:stateChanges.map(event=>({time:event.time,state:event.state,reason:event.reason})),
    hits:hits.length,latches:latched.length,replays:replayed.length,reachedXX:stateChanges.some(event=>event.state==='RSI_COMBO_XX'),
    reachedForwardX:stateChanges.some(event=>event.state==='RSI_OVER_TAKER_COMBO_XXfrontX'),
    heldForwardFacing:samples.every(sample=>sample.facing===facing),
    reachedMapEnd:samples.some(sample=>Math.abs(sample.targetPosition[0])===2200),
    stoppedAttackPackets:samples.filter(sample=>sample.packet.pressed.includes(key)&&sample.before.hitStop>0).map(sample=>({step:sample.step,
      state:sample.before.state,animationTime:sample.before.animationTime,hitStop:sample.before.hitStop,flags:sample.flags,latch:sample.latch})),
    final:{state:f.a.state,position:[f.a.x,f.a.y,f.a.z],targetPosition:[f.b.x,f.b.y,f.b.z]}};
  return {evidenceClass:'production-native-simulation',targetClientMeasured:false,summary,samples,packets,events,
    snapshot:JSON.parse(JSON.stringify(f.s.snapshot()))};
}
export async function verifyComboStopReplay(row){
  const f=await comboStopFixture(row.summary.fixture);
  for(const packet of row.packets)comboStopFrame(f,packet);
  const canonical=value=>JSON.stringify(value),hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
  const events=f.s.drainEvents();
  if(hash(f.s.snapshot())!==hash(row.snapshot)||hash(events)!==hash(row.events))throw Error('Full input replay mismatch');
  const restored=await comboStopFixture(row.summary.fixture);restored.s.restore(row.snapshot);
  for(let i=0;i<60;i++){comboStopFrame(f);comboStopFrame(restored);if(hash(f.s.snapshot())!==hash(restored.s.snapshot()))throw Error('JSON restore mismatch');}
  return {fullInputPackets:row.packets.length,eventsAndSnapshotIdentical:true,jsonRestorePackets:60};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const rows=[];
  for(const facing of [-1,1])for(const corner of [false,true])for(const hit of [false,true])for(const speed of [1,1.4,1.8])
    for(const interval of [6,10,15])for(const adaptation of [false,true])rows.push(await observeComboStopV7({facing,corner,hit,speed,interval,adaptation}));
  for(const facing of [-1,1])for(const corner of [false,true])for(const adaptation of [false,true])
    rows.push(await observeComboStopV7({facing,corner,dashFirst:true,adaptation}));
  const replays=[];
  for(const row of rows.filter(row=>row.summary.fixture.speed===1.4&&row.summary.fixture.interval===15&&!row.summary.fixture.dashFirst))
    replays.push({...row.summary.fixture,...await verifyComboStopReplay(row)});
  const out=process.argv[2]??'runtime/combo-stop-v7/observations.json';mkdirSync(resolve(project,out,'..'),{recursive:true});
  writeFileSync(resolve(project,out),JSON.stringify({schema:'rf-combo-stop-observations-v7',targetClientMeasured:false,rows,replays},null,2)+'\n');
  const summaryPath='runtime/combo-stop-v7/summary.json';mkdirSync(resolve(project,summaryPath,'..'),{recursive:true});
  writeFileSync(resolve(project,summaryPath),JSON.stringify({schema:'rf-combo-stop-summary-v7',evidenceClass:'production-native-simulation',targetClientMeasured:false,
    rows:rows.map(row=>row.summary),replays},null,2)+'\n');
  console.log(JSON.stringify({out,summaryPath,rows:rows.length,replays:replays.length,
    baselineXX:rows.filter(row=>!row.summary.fixture.adaptation&&row.summary.reachedXX).length,
    adaptedXX:rows.filter(row=>row.summary.fixture.adaptation&&row.summary.reachedXX).length}));
}
