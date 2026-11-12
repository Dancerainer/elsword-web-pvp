import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const tick=(sim,n,input={})=>{for(let i=0;i<n;i++)sim.step(1/60,input);};
for(const mutation of [false,true])for(const facing of [1,-1])test(`real MM Fission expires into ${mutation?8:4} original radial projectiles, facing${facing}`,()=>{
 const {sim,a,b,profile}=originalAddFixture('MM',{skillId:29209});a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1200;
 if(mutation){assert.equal(sim.tryAwakening(a),true);tick(sim,120);a.sourceAdd.mutation=1;a.sourceAdd.dp=8000;a.mp=a.mpMax;}
 a.facing=facing;tick(sim,1,{add:{pressed:['A'],held:['A']}});tick(sim,61);
 const split=sim.state.effects.filter(e=>e.sourceAddFissionSplit);assert.equal(split.length,mutation?8:4,JSON.stringify({notes:a.unsupported.slice(-7),state:a.state,events:sim.state.events.slice(-5)}));
 // These independent expectations are the2016 DIE_DAMAGE_EFFECT declarations.
 const angles=mutation?[45,-45,135,-135,0,90,180,-90]:[45,-45,135,-135];
 assert.deepEqual(split.map(e=>e.birthAnchor.rotation[2]),angles);assert.ok(split.every(e=>e.definition.SCALE_X===.66&&e.definition.SCALE_Y===.66&&e.definition.SCALE_Z===.66));
 assert.ok(split.every(e=>e.sourceShadowMesh));
 const original=split.map(e=>[...e.currentAnchor.position]);tick(sim,4);
 for(let i=0;i<split.length;i++){
  const dx=split[i].x-original[i][0],dy=split[i].y-original[i][1],theta=(angles[i]+10)*Math.PI/180;
  assert.ok(Math.abs(dx-600*Math.cos(theta)*4/60)<.01);assert.ok(Math.abs(dy-600*Math.sin(theta)*4/60)<.01);
 }
 if(mutation)assert.equal(a.sourceAdd.mutation,0,'spends the one mutation point once');
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:66}))),state=validateOwnedState(raw),context={actors:sim.state.actors,profiles:sim.profiles};
 validateOwnedReferences(state,a,profile,sim.map,context);applyOwnedState(sim,a.id,state);
 assert.equal(sim.state.effects.filter(e=>e.sourceAddFissionSplit).length,angles.length);
 const bad=structuredClone(raw),child=bad.effects.find(e=>e.sourceAddFissionSplit);child.sourceAddFissionSplit.parentName='DamageEffect_AAT_Rushing_Drone';
 assert.throws(()=>validateOwnedState(bad),/fission/);
});
