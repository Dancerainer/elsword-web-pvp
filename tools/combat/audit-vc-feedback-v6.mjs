import {vcFixture} from '../../tests/helpers/vc-fixture.mjs';
import {writeFileSync} from 'node:fs';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {vcCommandAirDashCancelDirection} from '../../packages/combat-core/vc-commands.mjs';
const rows=[];
for(const facing of[-1,1]){
 const {sim,a}=vcFixture({gap:2500,position:[0,9000,0],facing});a.grounded=false;a.lineId=null;sim.enter(a,'RSI_DASH_JUMP','high-air-fixture');const heights=[];
 for(let i=0;i<1800&&heights.length<10;i++){
  let pressed=[],held=[];
  if(a.state==='RSI_DASH_JUMP')pressed=['Z'];
  if(a.state==='RSI_DASH_JUMP_COMBO_Z'&&a.animationTime>.07&&!(a.sourceCommandFlags&2))pressed=['X'];
  if(a.state==='RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX'&&vcCommandAirDashCancelDirection(a,sim.profileFor(a).states[a.state],{pureDoubleRight:true})){pressed=['DASH','Z'];held=[a.facing===1?'LEFT':'RIGHT'];heights.push({y:a.y,t:a.stateTime,anim:a.animationTime});}
  sim.step(1/60,{vc:{pressed,held}},{snapshot:false});sim.drainEvents();
 }
 rows.push({kind:'repeatZX',facing,heights});
}
for(const skillId of[24221,24218,24024]){
 const {sim,a}=vcFixture({skillId,position:[-600,3080,0],gap:160}),events=[],names={};const initialHp=a.hp,initialStats=structuredClone(a.stats);
 for(let i=0;i<600;i++){sim.step(1/60,{vc:{pressed:i===0||skillId===24024&&i<190&&i%2===0?['A']:[]}},{snapshot:false});for(const e of sim.drainEvents()){if(e.type==='effectStarted')names[e.effectId]=e.name;events.push(e);}}
 rows.push({kind:'skill',skillId,hpMax:a.hpMax,initialStats,hpCost:initialHp-a.hp,hpCostFraction:(initialHp-a.hp)/a.hpMax,penalties:events.filter(e=>e.type==='overheatHpChanged'),residualHits:events.filter(e=>e.type==='hit'&&e.data.REACT_TYPE===7).map(e=>({time:e.time,name:names[e.origin.id],amount:e.amount})),residualSounds:events.filter(e=>e.type==='sound'&&e.field==='original-damage-hit'&&/MEMO/.test(names[e.origin?.id]??'')).map(e=>({time:e.time,name:e.name,effect:names[e.origin.id]}))});
}
writeFileSync('reports/vc-feedback-observations-v6.json',JSON.stringify({coreVersion:CORE_VERSION,evidence:'current simulation on original converted geometry; NOT original-client expected values',rows},null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>r.kind==='repeatZX'?{kind:r.kind,facing:r.facing,first:r.heights[0],last:r.heights.at(-1)}:{skill:r.skillId,cost:r.hpCost,percent:100*r.hpCostFraction,residualHits:r.residualHits.length,residualSounds:r.residualSounds.length})));
