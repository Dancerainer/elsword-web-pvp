/** Target impulses versus a separately compiled original source scheduler.
 * The bounded Now/Future mismatch remains explicit; this is not client QA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vcFixture} from '../helpers/vc-fixture.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/vc-zxx-schedule-source-v5.json',import.meta.url)));
const states=['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX'];
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.003,`${message}: ${actual} != ${expected}`);

test('compiled deferred ZX/ZXX dispatcher isolates one packet / 2.222 Y units, with no horizontal change',()=>{
  assert.equal(source.targetClientMeasured,false);
  assert.equal(source.cases.length,240);
  assert.equal(source.summary.firstNativeZxxFrame,28);
  assert.equal(source.summary.firstImmediateZxxFrame,27);
  assert.equal(source.summary.maxHorizontalDifference,0);
  near(source.summary.maxVerticalDifference,20/9,'bounded gravity phase difference');
  for(const facing of[-1,1]){
    const native=source.cases.filter(r=>r.mode===0&&r.facing===facing);
    assert.equal(native[27].state,0);assert.equal(native[27].pending,1);
    assert.equal(native[28].state,1);assert.equal(native[28].vy,125);
    near(native[29].vy,125-4000/60,'next packet restores gravity');
    near(native[30].vy,700-4000/60,'target .033 pulse resets vertical speed');
    near(native[30].vx,(-750+2000/60)*facing,'target .033 pulse and friction set recoil');
  }
});

for(const facing of[-1,1])test(`current ZX/ZXX impulse path matches source; immediate Now phase remains recorded, facing ${facing}`,()=>{
  // High airborne start excludes real-map landing from this bounded comparison.
  // Full physical 668 and airborne 66 follow-ups are covered in vc-air-commands-v3.
  const {sim,a}=vcFixture({position:[0,10000,0],gap:2500,facing});
  a.grounded=false;a.lineId=null;a.vx=750*facing;a.vy=-100;
  sim.enter(a,states[0],'independent-source-schedule-comparison');
  const sourceRows=source.cases.filter(r=>r.mode===1&&r.facing===facing);
  const nativeRows=source.cases.filter(r=>r.mode===0&&r.facing===facing);
  for(const r of sourceRows){
    sim.step(1/60,{vc:{pressed:r.frame===4?['X']:[],held:r.frame===4?['X']:[]}},{snapshot:false});
    assert.equal(a.state,states[r.state],`frame ${r.frame}`);
    near(a.animationTime,r.time,`clock frame ${r.frame}`);
    near(a.x,nativeRows[r.frame].x,`original horizontal path frame ${r.frame}`);
    near(a.y-10000,r.y,`explicit immediate phase analogue frame ${r.frame}`);
    near(a.vx,r.vx,`vx frame ${r.frame}`);near(a.vy,r.vy,`vy frame ${r.frame}`);
    assert.equal(a.skillDisableGravity,r.gravityDisabled);
  }
});
