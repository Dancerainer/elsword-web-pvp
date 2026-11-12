import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,makePlatformDown,runPlatform} from '../helpers/platform-down-v20-fixture.mjs';
for(const facing of [-1,1])for(const back of [false,true])for(const pickup of [false,true])
test(`actual platform2X loses down support and ${pickup?'receives a real Z pickup':'lands'} facing${facing} back${back}`,()=>{
  const result=runPlatform({facing,back,pickup}),{s,frames,reactions,timeline}=result;
  const first=reactions[0];assert.equal(first.data.REACT_TYPE,3);assert.equal(first.before.grounded,true);
  assert.equal(first.after.state,back?'RSI_DAMAGE_DOWN_BACK':'RSI_DAMAGE_DOWN_FRONT');
  const fall=frames.find(f=>f.target.state==='RSI_DAMAGE_AIR_FALL');assert.ok(fall,'ground down must turn into fall before its animation ends');
  assert.equal(fall.target.grounded,false);assert.equal(fall.target.animationName,'DamageAirFall');
  assert.ok(Math.abs(fall.target.x)>800,'actual original upper platform endpoint crossed');
  assert.ok(frames.some(f=>f.target.grounded&&f.target.y===3560),'actual lower original platform reached');
  if(pickup){const hit=reactions.find(r=>r.attacker==='pickup');assert.ok(hit,'real lower-platform Z must hit the falling victim');
    assert.equal(hit.before.state,'RSI_DAMAGE_AIR_FALL');assert.match(hit.after.state,/^RSI_DAMAGE_SMALL_(FRONT|BACK)$/);
    assert.equal(hit.after.y,hit.before.y);assert.equal(hit.after.vy,Math.min(0,hit.before.vy));
  }else assert.ok(frames.some(f=>f.target.state==='RSI_DAMAGE_AIR_DOWN_LANDING'));
  assert.equal(s.actor('target').state,'RSI_WAIT');
  const replay=makePlatformDown({facing,back,pickup});for(const input of timeline)replay.step(1/60,input,{snapshot:false});
  assert.deepEqual(replay.snapshot(),s.snapshot(),'complete device inputs replay identically');
  const resumed=makePlatformDown({facing,back,pickup});for(const input of timeline.slice(0,12))resumed.step(1/60,input,{snapshot:false});
  const restored=makePlatformDown({facing,back,pickup});restored.restore(clone(resumed.snapshot()));
  for(const input of timeline.slice(12)){resumed.step(1/60,input,{snapshot:false});restored.step(1/60,input,{snapshot:false});}
  assert.deepEqual(clone(restored.snapshot()),clone(resumed.snapshot()),'JSON serialized state during falling resumes identically');
});
test('lost-support conversion preserves an independent mana-break knockdown gauge',()=>{
  const s=makePlatformDown(),b=s.actor('target');s.enter(b,'RSI_DAMAGE_DOWN_FRONT','explicit-mana-down-boundary');
  b.grounded=false;b.lineId=null;b.knockdown.now=42;b.knockdown.pending=null;b.knockdown.activated=false;
  const before=clone(b.knockdown);s.processInput(b,{held:new Set(),pressed:new Set(),released:new Set()});
  assert.equal(b.state,'RSI_DAMAGE_AIR_FALL');assert.deepEqual(b.knockdown,before);
});
