import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
import {arcNativeInput} from '../../packages/combat-core/skill-candidates.mjs';
import {arcLineBasis} from '../../packages/combat-core/archenemy-mesh.mjs';
import {selectHitReaction,defenderHitStopOverride} from '../../packages/combat-core/reaction-policy.mjs';
import {makeChain,runChain,inputTimeline,read,project,impactIndex,audioManifest,json,newSkillsPath} from '../helpers/archenemy-v19-fixture.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('target KL closure owns three normal/eight Hyper impact entries, exact templates and independently hashed resources',()=>{
  const c=read('contracts/rf-archenemy-hit-assets-v19.json');
  assert.equal(c.targetClientMeasured,false);
  const keys=raw=>Object.keys(raw).filter(k=>/^HIT_PARTICLE\d+$/.test(k));
  assert.equal(keys(c.bindings.RAVEN_OVER_TAKER_ARC_ENEMY).length,3);
  assert.equal(keys(c.bindings.RAVEN_OVER_TAKER_ARC_ENEMY_HYPER).length,8);
  for(const raw of Object.values(c.bindings))for(const key of keys(raw))assert.ok(impactIndex.templates[raw[key].PARTICLE_NAME]);
  // The aggregate index also contains unrelated effects and has since been
  // compacted. Compare this historical closure to its independently sealed
  // templates, while retaining byte hashes for all seven standalone inputs.
  const aggregatePath='artifacts/rf/fx/index.json',aggregate=JSON.parse(readFileSync(resolve(project,aggregatePath),'utf8'));
  for(const [name,template]of Object.entries(impactIndex.templates))assert.deepEqual(aggregate.templates[name],template,name);
  for(const file of c.integration.inventory.filter(file=>file.path!==aggregatePath)){
    const bytes=readFileSync(resolve(project,file.path));assert.equal(bytes.length,file.bytes,file.path);assert.equal(digest(bytes),file.sha256,file.path);}
  assert.equal(audioManifest.files[c.releaseSound.file].sha256,c.releaseSound.sha256);
});

test('independent untouched C++ RT_BIG/StopTime probe is the boundary oracle, not a JS-generated expectation',()=>{
  const p=read('reports/rf-archenemy-reaction-probe-v19.json');assert.equal(p.rows.length,18);assert.equal(p.targetClientMeasured,false);
  for(const row of p.rows){
    const fromFront=row.front??true,height=row.height??400,superArmor=row.armor??false;
    const r=selectHitReaction({REACT_TYPE:2,BACK_SPEED_Y:-1000},{heightAboveLand:height,fromFront,superArmor,
      attackerUnitHeightAboveLand:row.attackerType===0?0:Infinity,vy:100});
    assert.equal(r.state,[null,'RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK','RSI_DAMAGE_AIR_SMALL'][row.state]);
    assert.equal(r.vy,row.vy);
    const stop=defenderHitStopOverride({REACT_TYPE:2,STOP_TIME_DEF:row.ownerGrounded?.valueOf()?Math.fround(.12):0},{superArmor});
    if(superArmor)assert.equal(stop,null);else assert.ok(Math.abs(stop.stopTime-row.stop)<1e-7);
  }
});

test('independently sealed modules expose70, reject historical HYPER and execute the shared event callback',async()=>{
  const frozen=read('contracts/rf-archenemy-chain-source-v19.json'),nextBytes=readFileSync(newSkillsPath),
    oldBytes=readFileSync(resolve(project,'.cache/native-skills-generated/skills.wasm'));
  for(const [bytes,expected]of [[nextBytes,frozen.native.newWasm],[oldBytes,frozen.native.oldWasm]]){
    assert.equal(bytes.length,expected.bytes);assert.equal(digest(bytes),expected.sha256);}
  const next=await instantiateNativeSkills(nextBytes);assert.equal(next.contract.callbackGroupCount,70);
  const old=await instantiateNativeSkills(oldBytes);
  assert.equal(old.contract.arcHyperFrameSupported,false);assert.throws(()=>old.evaluate({kind:70}),RangeError);
  const reuse=frozen.eventProcessReuse;
  assert.equal(reuse.byteIdenticalBodies,true);assert.equal(reuse.sharedCallbackGroup,18);
  assert.equal(reuse.hyper.bodySha256,reuse.normal.bodySha256);
  const s=await makeChain(),input=arcNativeInput(s.actor('rf'),s.state.effects,{kind:18,dt:1/60});
  assert.equal(next.evaluate({...input,ended:false,grounded:true}).stateChange,0);
  assert.equal(next.evaluate({...input,ended:true,grounded:true}).stateChange,3);
  assert.equal(next.evaluate({...input,ended:true,grounded:false}).stateChange,4);
});

const missingSourceContracts=['.cache/native-skills-generated/source-contract.json','.cache/native-archenemy-skills-v19/source-contract.json']
  .filter(file=>!existsSync(resolve(project,file)));
const metadataPins=[
  ['.cache/native-skills-generated/source-contract.json',read('contracts/rf-awakened-skills-source-v17.json').compiledFiles.find(row=>row.path==='.cache/native-awakened-skills-v17/source-contract.json')],
  ['.cache/native-archenemy-skills-v19/source-contract.json',read('contracts/rf-archenemy-chain-source-v19.json').native.compiledFiles.find(row=>row.path==='.cache/native-archenemy-skills-v19/source-contract.json')],
];
// Check each existing input even if the other historical input is missing.
for(const [file,expected]of metadataPins)test(file+' retains its independent metadata byte identity',{
  skip:existsSync(resolve(project,file))?false:'Historical source metadata unavailable: '+file,
},()=>{const bytes=readFileSync(resolve(project,file));assert.equal(bytes.length,expected.bytes,file);assert.equal(digest(bytes),expected.sha256,file);});
test('historical source-contract pins retain all old70 methods and the original HYPER body',{
  skip:missingSourceContracts.length?'Historical source metadata unavailable: '+missingSourceContracts.join(', '):false,
},()=>{
  const currentSeal=read('contracts/rf-archenemy-chain-source-v19.json');
  const prior=read('.cache/native-skills-generated/source-contract.json'),current=read('.cache/native-archenemy-skills-v19/source-contract.json');
  const all=[...current.functions,...current.extraFunctions],previous=[...prior.functions,...prior.extraFunctions];
  assert.equal(all.length,71);assert.equal(previous.length,70);
  for(const row of previous)assert.deepEqual(all.find(n=>n.name===row.name),row);
  // Pinned reference bytes, separately verified by the independent Python
  // original_definition scanner in skills-build.test.py.
  assert.equal(all.find(n=>n.name==='RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove').sha256,'384a2b65898800558aceb6dc6bd0b570474ccf4f949058063699a8f13ae6cbec');
  const reuse=currentSeal.eventProcessReuse;
  assert.equal(all.find(n=>n.name===reuse.normal.name).sha256,reuse.normal.sha256);
});

for(const facing of [-1,1])for(const hyper of [false,true])for(const far of [false,true])for(const air of [false,true])
test(`real keyboard ArcEnemy ${facing}/${hyper?'Hyper':'normal'}/${far?'far':'near'}/${air?'air':'ground'} hits, reacts, expires and restores`,async()=>{
  const {s,frames,reactions}=await runChain({facing,hyper,far,air});
  assert.equal(reactions.length,1);const impact=reactions[0],h=impact.hit;
  assert.ok(h.amount>0);assert.equal(h.data.DAMAGE.MAGIC,hyper?5.72:4.48);assert.equal(h.data.REACT_TYPE,2);
  assert.equal(impact.hitStop,0);assert.equal(impact.worldStop,0);
  // Original source probe: effect hits use victim height <30*5, irrespective
  // of owner height. The far target can land on another real map line while
  // this input sequence runs; a requested jump does not force an air reaction.
  assert.equal(impact.state,impact.heightAboveLand<150?'RSI_DAMAGE_BIG_FRONT':'RSI_DAMAGE_AIR_SMALL');
  if(air&&!far)assert.ok(impact.heightAboveLand>=150);
  const later=frames.filter(f=>f.time>impact.time&&f.time<impact.time+.07).map(f=>f.target);
  assert.ok(later.some(f=>f.animationTime>impact.animationTime),'reaction animation advances with zero STOP_DEF');
  const starts=s.state.events.filter(e=>e.type==='effectStarted'&&e.sourceArcStartMesh);
  assert.equal(starts.length,4);assert.equal(s.actor('rf').sourceArcEnemy.data.length,3);
  assert.ok(s.state.events.some(e=>e.type==='sound'&&e.name==='Raven_OT_SP2_FlyingImpact3.ogg'));
  assert.ok(s.state.events.some(e=>e.type==='sound'&&e.field==='original-damage-hit'&&e.origin.id===h.origin.id));
  assert.ok(s.state.events.some(e=>e.type==='effectEnded'&&e.effectId===h.origin.id&&e.reason==='hit-limit'));
  assert.equal(s.state.effects.some(e=>e.id===h.origin.id),false);
  const saved=json(s.snapshot()),restored=await makeChain({facing,hyper,far});restored.restore(saved);
  for(let i=0;i<120;i++){s.step(1/60,{}, {snapshot:false});restored.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(json(s.snapshot()),json(restored.snapshot()));
  for(let i=0;i<132;i++)s.step(.25,{}, {snapshot:false});
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,0);assert.equal(s.state.effects.some(e=>e.sourceArcHandle),false);
});

test('cast-frozen Hyper callback persists if the awakening clock reaches zero before spear creation',async()=>{
  const s=await makeChain();s.actor('rf').awakening.remaining=.08;
  s.step(1/60,{pressed:['A']},{snapshot:false});for(let i=0;i<180;i++)s.step(1/60,{}, {snapshot:false});
  assert.equal(s.actor('rf').awakening.remaining,0);
  assert.equal(s.state.effects.filter(e=>e.sourceArcHandle).length,4);
  assert.ok(s.state.effects.filter(e=>e.sourceArcHandle).every(e=>e.name==='RAVEN_OVER_TAKER_ARC_ENEMY_HYPER'));
});

test('real three-bead aura hits occur while four waiting spears remain unconsumed',async()=>{
  const s=await makeChain({hyper:true});
  for(const frame of inputTimeline({hyper:true}).slice(0,272))s.step(frame.dt,frame.input,{snapshot:false});
  assert.ok(s.state.events.some(e=>e.type==='hit'&&e.data.HIT_TYPE===23&&e.origin.skillId===null),'actual electric-aura hits, not an injected callback');
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,4);
  assert.equal(s.state.events.some(e=>e.type==='sound'&&e.field==='original-arc-release'),false);
});

for(const facing of [-1,1])test(`keyboard Z, recovery, approach and second Z ${facing} visibly restart two ordinary Big reactions`,async()=>{
  const s=await makeChain({facing});
  for(const frame of inputTimeline({facing}).slice(0,270))s.step(frame.dt,frame.input,{snapshot:false});
  const first=s.state.events.find(e=>e.type==='hit'&&e.origin.skillId===24008);assert.ok(first);
  assert.equal(s.actor('target').state,'RSI_WAIT');
  for(let i=0;i<20;i++)s.step(1/60,{held:[facing>0?'RIGHT':'LEFT']},{snapshot:false});
  s.step(1/60,{pressed:['Z']},{snapshot:false});
  let second;
  for(let i=0;i<120;i++){
    const before=s.state.events.length;s.step(1/60,{}, {snapshot:false});
    const event=s.state.events.slice(before).find(e=>e.type==='hit'&&e.origin.skillId===24008);
    if(event){second=event;assert.equal(s.actor('target').state,'RSI_DAMAGE_BIG_FRONT');assert.equal(s.actor('target').hitStop,0);}
  }
  assert.ok(second);assert.notEqual(second.origin.id,first.origin.id);
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,2);
  assert.equal(s.actor('target').state,'RSI_WAIT');
});

for(const trigger of ['active','special'])test(`actual ${trigger} damage-effect hit excludes the owned spear`,async()=>{
  const {s}=await runChain({trigger});
  assert.ok(s.state.events.some(e=>e.type==='hit'&&e.origin.skillId===(trigger==='active'?24204:24025)));
  assert.equal(s.actor('rf').sourceArcEnemy.data.length,4);
  assert.equal(s.state.events.some(e=>e.type==='sound'&&e.field==='original-arc-release'),false);
});

test('ordinary repeated hit callback retains original .3s release cooldown and does not relaunch a released spear',async()=>{
  const s=await makeChain();for(const frame of inputTimeline().slice(0,181))s.step(frame.dt,frame.input,{snapshot:false});
  const a=s.actor('rf'),b=s.actor('target'),basis=arcLineBasis(a,s.map.lines);
  const call=dt=>{const r=s.nativeSkills.evaluate(arcNativeInput(a,s.state.effects,{kind:27,dt,defender:b,defenderUID:2,basis}));s.executeArcCommands(a,r);return r;};
  assert.equal(call(0).sounds,1);assert.equal(call(0).sounds,0);assert.equal(a.sourceArcEnemy.data.length,3);
  for(let i=0;i<19;i++)s.step(1/60,{}, {snapshot:false});assert.equal(call(0).sounds,1);
  assert.equal(a.sourceArcEnemy.data.length,2);
});
