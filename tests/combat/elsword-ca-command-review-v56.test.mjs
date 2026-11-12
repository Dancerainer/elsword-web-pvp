/** Target2016 declarations / pinned original post bytes are independent of
 * the current Web traces. Garpai, poses and attack helpers are real inputs;
 * reported peak heights are Web simulation checks, never client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const dt=1/60,read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const review=read('contracts/elsword-ca-command-review-v56.json');
const base=await lkCommandFixture({gap:5000});
test('independent original143/144 post slices retain their source bytes and literal successors',()=>{
 const [x1,x2]=review.originalPostBodies;
 for(const row of [x1,x2]){
  const bytes=Buffer.from(row.source.bytesHex,'hex');assert.equal(bytes.length,row.source.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.source.sha256);
 }
 assert.equal(x1.entry,'0x3294c4f0');assert.match(x1.source.bytesHex,/6890000000/,'the freshX branch pushes native144');
 assert.equal(x2.entry,'0x3294c690');assert.match(x2.source.bytesHex,/6892000000/,'native144 on-contact pushes native146');
 assert.equal(review.original66X.raw.DAMAGE_DATA.BACK_SPEED_Y,1950);
 assert.equal(review.original66X.raw.DAMAGE_DATA.REACT_TYPE,4);
});
async function elsword(profession,facing){
 if(profession==='LK')return lkCommandFixture({gap:85,facing});
 const folder=profession.toLowerCase(),profile=read(`packages/combat-core/${folder}-profile.json`),rawPose=read(`artifacts/${folder}/runtime-pose.json`),
  characterPose=composeCharacterPose(rawPose,rawPose.sharedPose?read(`artifacts/${folder}/${rawPose.sharedPose}`):null),
  effectIndex=mergeEffectIndexes(read(`artifacts/${folder}/effect-assets.json`),read(`artifacts/${folder}/fx/index.json`)),
  effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(`artifacts/${folder}/${p}`)]));
 const sim=createSimulation({profile,map:base.map,seed:2016,preset:{loadout:Array(8).fill(null),passives:[],guildPassives:[],doubleTapWindowSeconds:.4},
  actors:[{id:'lk',professionId:profession,team:0,position:[0,3080,0],lineId:2,facing},
   {id:'target',professionId:profession,team:1,position:[85*facing,3080,0],lineId:2,facing:-facing,loadout:Array(8).fill(null)}],
  ...createNativeSamplers({profile,characterPose,effectIndex,effectPoses}),nativeGeometry:base.sim.nativeGeometry,
  nativeSkillValues:base.sim.nativeSkillValues,nativeCritical:base.sim.nativeCritical,nativeManaBreak:base.sim.nativeManaBreak});
 return {sim,profile,map:base.map,actor:sim.actor('lk'),target:sim.actor('target')};
}
for(const profession of ['LK','RS','IS'])for(const facing of [-1,1])
test(`${profession} ${facing}: original66X launches once at1950 and obeys actual gravity`,async()=>{
 const {sim,profile,actor:a,target:b}=await elsword(profession,facing);
 sim.step(dt,{}, {snapshot:false});const floor=b.y,hits=[],apply=sim.applyHit.bind(sim);
 sim.applyHit=(attacker,victim,data,origin)=>{const result=apply(attacker,victim,data,origin);
  if(result.accepted&&attacker===a&&victim===b)hits.push({type:data.REACT_TYPE,backY:data.BACK_SPEED_Y,vy:b.vy,state:b.state});return result;};
 assert.equal(profile.states.RSI_DASH_COMBO_X.raw.DAMAGE_DATA.BACK_SPEED_Y,1950);
 assert.equal(profile.physics.G_ACCEL,4000);sim.enter(a,'RSI_DASH_COMBO_X','v56-source66X');
 let peak=floor;for(let i=0;i<150;i++){sim.step(dt,{}, {snapshot:false});peak=Math.max(peak,b.y);}
 assert.deepEqual(hits,[{type:4,backY:1950,vy:1950,state:'RSI_DAMAGE_AIR_UP'}]);
 // Independent semi-implicit sum: each packet deducts4000/60 before moving.
 // There are29 positive velocity packets after the initial1950 assignment.
 const count=29,expected=(count*1950-4000*dt*count*(count+1)/2)*dt;
 assert.ok(Math.abs(peak-floor-expected)<1e-6,`${peak-floor} != ${expected}`);
});

// V57 corrects V56's table-selection conclusion: the shared post requests144,
// but fixed SwordMan1160..1196 registers144 to the Knight table for LK. Raw
// original post byte assertions above remain unchanged and independently true.
for(const facing of [-1,1])test(`LK ${facing}: physical668XXX preserves shared143→144 and selects LK's class-specific144/145 tables`,async()=>{
 const f=await lkCommandFixture({gap:5000,facing}),{sim,actor:a}=f,buffer=createInputBuffer({sampledLevels:true}),forward=facing>0?'RIGHT':'LEFT';
 const step=()=>sim.step(dt,{lk:buffer.consume(sim.state.time+dt)},{snapshot:false}),
  edge=(key,down)=>{buffer[down?'down':'up'](key,sim.state.time+.001);step();},tap=key=>{edge(key,true);edge(key,false);};
 step();tap(forward);edge(forward,true);tap('UP');for(let i=0;i<4;i++)step();tap('X');tap('X');
 for(let i=0;i<100&&a.state!=='ESSI_KNIGHT_DASH_JUMP_COMBO_X2';i++)step();assert.equal(a.state,'ESSI_KNIGHT_DASH_JUMP_COMBO_X2');tap('X');
 for(let i=0;i<100&&a.state!=='ESSI_KNIGHT_DASH_JUMP_COMBO_X3';i++)step();assert.equal(a.state,'ESSI_KNIGHT_DASH_JUMP_COMBO_X3');
 const states=sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id).map(e=>e.state);
 assert.ok(states.includes('RSI_DASH_JUMP_COMBO_X'));assert.ok(states.includes('ESSI_KNIGHT_DASH_JUMP_COMBO_X2'));assert.ok(states.includes('ESSI_KNIGHT_DASH_JUMP_COMBO_X3'));
});

for(const facing of [-1,1])test(`CA ${facing}: capped renewal chain reaches its existing horizontal finisher once`,()=>{
 const f=elesisFixture('CA',{gap:5000,facing,position:[-facing*800,3080,0]}),{sim,a,b}=f;sim.step(dt,{}, {snapshot:false});
 sim.enter(a,'ESI_DASH_COMBO_SCA_ZZZ_START','v56-renewal-entry');
 const end='ESI_DASH_COMBO_SCA_ZZZ_END';
 for(let i=1;i<=150&&a.state!==end;i++)sim.step(dt,{elesis:{pressed:i%6===1?['Z']:[],held:['Z']}},{snapshot:false});
 assert.equal(a.state,end);assert.equal(a.sourceElesisCommand.loops,4);
 const states=sim.state.events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id).map(e=>e.state);
 assert.equal(states.filter(n=>n===end).length,1);
 assert.deepEqual(states.filter(n=>/^ESI_DASH_COMBO_SCA_ZZZ_LOOP_[12]$/.test(n)),[
  'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2']);
 const raw=f.profile.states[end].raw;
 assert.equal(raw.DAMAGE_DATA.REACT_TYPE,5);assert.equal(raw.DAMAGE_DATA.BACK_SPEED_X,500);
 assert.equal(raw.DAMAGE_DATA.BACK_SPEED_Y,undefined,'horizontal FLY does not license an invented launch speed');
 // Isolate the authored finisher body from its already-fired projectile
 // siblings; place a fresh target within its actual original weapon helpers.
 for(const effect of sim.state.effects)if(effect.ownerId===a.id)effect.dead=true;
 Object.assign(b,{x:a.x+facing*85,y:a.y,z:a.z,lineId:a.lineId,lastTouchLineId:a.lineId,landPosition:[a.x+facing*85,a.y,a.z],grounded:true,forceInvincible:0});
 sim.enter(b,'RSI_WAIT','v56-finisher-target');
 const contacts=[],apply=sim.applyHit.bind(sim);sim.applyHit=(attacker,victim,data,origin)=>{const result=apply(attacker,victim,data,origin);
  if(result.accepted&&attacker===a&&victim===b&&origin.kind==='character'&&origin.state===end)
   contacts.push({type:data.REACT_TYPE,backX:data.BACK_SPEED_X,backY:data.BACK_SPEED_Y??0,vx:b.vx,vy:b.vy,state:b.state});return result;};
 for(let i=0;i<90;i++)sim.step(dt,{}, {snapshot:false});
 assert.equal(contacts.length,1);assert.deepEqual(contacts[0],{type:5,backX:500,backY:0,vx:500*facing,vy:0,state:'RSI_DAMAGE_AIR_FLY_FRONT'});
});
