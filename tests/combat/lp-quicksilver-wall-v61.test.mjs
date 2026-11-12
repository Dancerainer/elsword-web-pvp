/** Authored Garpai endpoints and accepted finishing hits; no rectangle map or
 * zeroed fake DD replaces the original attacks. This is a V61 project rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addQuicksilverWallImpactPosition} from '../../packages/combat-core/add-quicksilver-wall-v61.mjs';
const dt=1/60;
for(const facing of [1,-1])test(`Quicksilver finishing hit catches the held victim at Garpai closed endpoint ${facing}`,t=>{
 const {sim,a,b}=originalAddFixture('LP',{skillId:29011});
 for(const actor of [a,b]){
  const x=facing*(actor===a?1900:2150),lineId=facing===1?6:0;
  Object.assign(actor,{x,y:2840,z:0,lineId,lastTouchLineId:lineId,landPosition:[x,2840,0],vx:0,vy:0,grounded:true});
 }
 a.facing=facing;b.facing=-facing;a.mp=a.mpMax;a.sourceAdd.dp=8000;b.hp=b.hpMax=99999999;
 let peak=2840,queued=0;const trace=[];
 for(let frame=0;frame<115;frame++){
  sim.step(dt,{add:frame===0?{pressed:['A'],held:['A']}:{}},{snapshot:false});
  peak=Math.max(peak,b.y);if(b.blackHoleDisplacement?.some(n=>n!==0))queued++;
  trace.push({frame,y:b.y,state:b.state});
 }
 const finishIds=new Set(sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_ALP_Quicksilver_Accel_Impact').map(e=>e.effectId));
 const finish=sim.state.events.filter(e=>e.type==='hit'&&finishIds.has(e.origin?.id));
 assert.ok(queued>10,'original accepted-hit black hole remains active');
 assert.equal(finish.length,1,'the real finishing attack must hit instead of leaving the old launch speed');
 assert.ok(peak<2840+200,`wall-held victim must not fly a whole platform above its floor: ${peak}`);
 assert.equal(b.y,2840);assert.equal(b.grounded,true);assert.equal(b.lastTouchLineId,facing===1?6:0);
 assert.deepEqual(a.unsupported,[]);assert.deepEqual(b.unsupported,[]);
 t.diagnostic(JSON.stringify({facing,queuedPackets:queued,finishingHits:finish.length,peakY:peak,finalY:b.y,finalLine:b.lastTouchLineId}));
});
test('wall policy changes only the beyond-end X/Z of the same grounded LP cast',()=>{
 const line={lineId:5,type:'LINE_TYPE.LT_NORMAL',start:[0,100,0],end:[0,100,1000],beforeLine:-1,nextLine:-2};
 const sim={map:{lines:[line]}},a={professionId:'LP',skillId:29011,grounded:true,lineId:5};
 assert.deepEqual(addQuicksilverWallImpactPosition(sim,a,[0,345,1200]),[0,345,1000]);
 const interior=[0,345,900];assert.equal(addQuicksilverWallImpactPosition(sim,a,interior),interior);
 const open=[0,345,-20];assert.equal(addQuicksilverWallImpactPosition(sim,a,open),open);
 for(const extra of [{professionId:'MM'},{skillId:29009},{grounded:false},{lineId:99}]){
  const p=[0,345,1200];assert.equal(addQuicksilverWallImpactPosition(sim,{...a,...extra},p),p);
 }
});
