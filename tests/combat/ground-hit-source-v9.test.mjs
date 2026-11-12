import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const bytes=readFileSync(new URL('../../artifacts/native/geometry.wasm',import.meta.url));
const map={sceneId:'source-ground-hit-topology-v9',lines:[
  {lineId:10,start:[-1000,0,0],end:[0,0,0],type:'LT_NORMAL',nextLine:20},
  {lineId:20,start:[0,0,0],end:[1000,0,0],type:'LT_NORMAL',beforeLine:10},
  {lineId:30,start:[-1000,50,0],end:[1000,50,0],type:'LT_NORMAL'},
]};
const data=profile.states.RRF_DASH_JUMP_COMBO_XX_LANDING.raw.DAMAGE_DATA;
async function make(target={},extra={}){
  return createSimulation({profile,map,preset:{passives:[],guildPassives:[],attributes:{hpMax:800000}},
    nativeGeometry:await createNativeGeometry({bytes,map}),
    actors:[{id:'rf',team:0,x:-100,y:0},{id:'target',team:1,x:300,y:0,facing:-1,...target}],...extra});
}
const check=s=>{const a=s.actor('rf');s.enter(a,'RRF_DASH_JUMP_COMBO_XX_LANDING','source-ground-hit-fixture');a.animationTime=.02;s.drainEvents();s.checkCharacterAttack(a,.01,.02);return s.drainEvents().filter(e=>e.type==='hit');};
test('668XX landing ground shock hits exactly once across adjacent authored lines at the inclusive 400 distance',async()=>{
  const s=await make(),hits=check(s);assert.equal(hits.length,1);assert.equal(hits[0].amount,3850);
  assert.equal(hits[0].origin.groundHit,true);assert.equal(s.actor('target').state,'RSI_DAMAGE_AIR_UP');
  assert.equal(s.actor('target').vy,1400);assert.equal(s.actor('target').hp,796150);
  const a=s.actor('rf');a.animationTime=.03;s.checkCharacterAttack(a,.02,.03);assert.equal(s.drainEvents().filter(e=>e.type==='hit').length,0);
});
test('400 range checks full 3D source entity distance, excludes outside and accepts opposite side',async()=>{
  assert.equal(check(await make({x:301})).length,0);
  assert.equal(check(await make({x:-500})).length,1);
  const s=await make({x:300});s.actor('target').z=1;assert.equal(check(s).length,0);
});
test('nearby higher platform is excluded by original line group; explicitly disabled group filter accepts it',async()=>{
  const s=await make({x:250,y:50,lineId:30});assert.equal(check(s).length,0);
  const a=s.actor('rf');assert.equal(s.checkGroundHits(a,{...data,DAMAGE_LINEGROUP:0},{},{kind:'character'}),1);
});
test('Now foot condition has strict 30 radius and differs from Future grounded/velocity condition',async()=>{
  for(const [height,hits] of [[29,1],[30,0],[31,0]]){
    const s=await make({x:200}),b=s.actor('target');b.y=height;b.grounded=false;b.lineId=null;b.vy=200;
    const events=check(s);assert.equal(events.length,hits,`Now foot height${height}`);
    if(hits)assert.equal(events[0].origin.groundHit,true);
  }
});
test('body collision runs before ground route and shares its history, so no double damage is fabricated',async()=>{
  const s=await make({x:0},{collisionSampler:()=>[{kind:'sphere',center:[0,70,0],radius:200}]});
  const hits=check(s);assert.equal(hits.length,1);assert.equal(hits[0].origin.groundHit,undefined);assert.equal(s.actor('target').hp,796150);
});
test('ordinary body route can still hit an airborne target; GroundHit alone cannot',async()=>{
  const s=await make({x:0},{collisionSampler:()=>[{kind:'sphere',center:[0,200,0],radius:200}]});
  const b=s.actor('target');b.y=200;b.grounded=false;b.lineId=null;
  const hits=check(s);assert.equal(hits.length,1);assert.equal(hits[0].origin.groundHit,undefined);
  const t=await make({x:0}),target=t.actor('target');target.y=200;target.grounded=false;target.lineId=null;assert.equal(check(t).length,0);
});
test('effect ground route measures its own position and line group rather than the owner',async()=>{
  const s=await make({x:700}),a=s.actor('rf');s.drainEvents();
  assert.equal(s.checkGroundHits(a,data,{}, {kind:'effect',id:777,attackPosition:[500,0,0],powerMultiplier:1}),1);
  assert.equal(s.drainEvents().find(e=>e.type==='hit').origin.attackPosition[0],500);
});
test('missing native ground queries fail closed and do not guess screen-space platform adjacency',()=>{
  const s=createSimulation({profile,map,actors:[{id:'rf',team:0,x:-100,y:0},{id:'target',team:1,x:300,y:0}]});
  assert.equal(check(s).length,0);assert.ok(s.actor('rf').unsupported.some(e=>e.id==='native-ground-hit-query-missing'));
});
test('ground-route history and launched target retain full JSON restoration and continuation consistency',async()=>{
  const s=await make(),restored=await make();check(s);s.drainEvents();restored.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<120;i++){s.step(1/120);restored.step(1/120);assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(restored.snapshot())));s.drainEvents();restored.drainEvents();}
});
