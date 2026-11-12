import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {updateDePhysicalModel2016} from '../../packages/combat-core/de-physical-objects-2016.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
function enterViaCommand(facing=1){
 const f=originalAddFixture('DE'),{sim,a,b}=f;a.mp=100;a.facing=facing;a.y+=50;a.grounded=false;a.lineId=null;b.x=1200;
 const integrate=sim.integrate.bind(sim),calls=[];sim.integrate=(actor,...args)=>{if(sim.dePredictionActive===actor)calls.push({state:actor.state,dt:args[0],vx:actor.vx});return integrate(actor,...args);};
 sim.enter(a,'ANSI_DASH_JUMP_COMBO_Z','source-aerial-command-input');sim.step(1/60,{add:{pressed:['X'],held:['X']}});
 for(let i=0;i<40&&!sim.state.events.some(e=>e.type==='dePredictionApplied');i++)sim.step(1/60,{});
 return {...f,calls};
}
for(const facing of [1,-1])test(`actual242 local entry facing${facing} invokes eight real physical packets and native CanDown, without advancing animation or extrapolating`,()=>{
 const {sim,a,b,calls}=enterViaCommand(facing),event=sim.state.events.find(e=>e.type==='dePredictionApplied');assert.ok(event);assert.equal(calls.length,8);assert.ok(calls.every(c=>c.state==='ANSI_ATT_DASH_JUMP_COMBO_ZX'&&c.dt===Math.fround(1/60)));
 assert.ok((event.position[0]-event.entry[0])*facing<0);assert.equal(event.steps,8);assert.equal(event.position[1],3080);assert.equal(a.vx,0);assert.ok(sim.dePhysicalObjects.state(b).cache?.valid);
 assert.equal(a.unsupported.some(n=>n.id==='de-prediction-full-physical-bridge'),false);
});
test('real physical support reset releases owned refs and applies bound associated-object method; these side effects survive helper coordinate restoration',()=>{
 const {sim,a}=originalAddFixture('DE');sim.step(1/60,{});a.y+=100;a.grounded=false;a.lineId=null;a.blackHoleDisplacement=[-3,-10,0];
 const destroyed=[],first={referenceCount:1,destroy:()=>destroyed.push('first')},second={referenceCount:2,destroy:()=>destroyed.push('second')},refs=[first,second],pet={repositioned:false,summonRequested:true,position:[0,0,0],placeOnOriginalLineMap(){this.position=[21,22,23];return true;}};
 const model={enabled:true,parent:null,radius:1,scale:[1,1,1],worldCenter:[0,0,0],refreshes:0,refreshTransform(){this.refreshes++;}};
 sim.dePhysicalObjects.bind(a,{supportReferences:refs,associatedPet:pet,model,cullQuery:{position:[3,4,0],planes:Array.from({length:6},()=>[0,0,0,1])}});
 sim.enter(a,'ANSI_ATT_DASH_JUMP_COMBO_ZX','source-conditional-input');assert.deepEqual(a.blackHoleDisplacement,[0,0,0]);assert.deepEqual(destroyed,['first']);assert.equal(first.referenceCount,0);assert.equal(second.referenceCount,1);assert.equal(refs.length,0);
 assert.equal(model.refreshes,8);assert.equal(model.distanceCache,5);assert.equal(model.planeIndex,-1);assert.equal(model.outside,false);assert.deepEqual(pet.position,[21,22,23]);assert.equal(pet.repositioned,true);assert.ok(sim.state.events.some(e=>e.type==='petSummonRequested'&&e.attack===false));
});
test('physical state requests remain pending through all eight calls and owner reconstruction, then apply on the next eligible actor callback',()=>{
 const {sim,a}=originalAddFixture('DE');sim.step(1/60,{});a.y+=100;a.grounded=false;a.lineId=null;
 const integrate=sim.integrate.bind(sim);let requested=false;sim.integrate=(actor,...args)=>{const result=integrate(actor,...args);if(sim.dePredictionActive===actor&&!requested){requested=true;sim.enter(actor,'RSI_JUMP_DOWN','air-reaction-apex');}return result;};
 sim.enter(a,'ANSI_ATT_DASH_JUMP_COMBO_ZX','source-conditional-request');assert.equal(a.state,'ANSI_ATT_DASH_JUMP_COMBO_ZX');assert.equal(a.sourceAddCombat.predictionRequest.state,'RSI_JUMP_DOWN');
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1})));validateOwnedState(wire);validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,wire);
 sim.step(1/60,{});assert.equal(a.sourceAddCombat.predictionRequest,undefined);assert.ok(sim.state.events.some(e=>e.type==='stateChanged'&&e.reason==='air-reaction-apex'));
 const bad=structuredClone(wire);bad.actor.sourceAddCombat.predictionRequest.state='unknown';assert.throws(()=>validateOwnedReferences(validateOwnedState(bad),a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles}));
});
test('source model helper stores distance before its radius early return, tests six planes in order and preserves old flags on the early return',()=>{
 const model={enabled:true,parent:null,radius:1,worldCenter:[10,0,0],scale:[1,1,1],outside:false,planeIndex:5},query={position:[7,4,0],planes:[[-1,0,0,0],...Array.from({length:5},()=>[0,0,0,1])]};
 assert.equal(updateDePhysicalModel2016(model,query),false);assert.equal(model.distanceCache,5);assert.equal(model.planeIndex,0);assert.equal(model.outside,true);
 model.radius=0;model.worldCenter=[7,4,0];assert.equal(updateDePhysicalModel2016(model,query),true);assert.equal(model.distanceCache,0);assert.equal(model.planeIndex,0);assert.equal(model.outside,true);
});
