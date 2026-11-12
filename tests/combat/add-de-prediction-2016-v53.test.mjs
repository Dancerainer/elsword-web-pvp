import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAddDePrediction2016} from '../../packages/combat-core/add-de-prediction-2016.mjs';
function fixture(queries){
 const actor={x:10,y:1000,z:30,vx:55,vy:0,hp:100,cache:0,pending:[],pet:{x:0}},calls=[];
 const bridge={readHorizontal:a=>a.vx,writeHorizontal:(a,v)=>a.vx=v,readSupportY:()=>222,
  fullPhysicsStep(a){a.x+=a.vx/60;a.y-=1;a.cache++;a.vy-=10;a.hp--;a.pending.push(a.cache);a.pet.x++;},
  queryDown(q){calls.push(q);return queries.shift();},lineAt:()=>({type:0,enabled:true})};return {actor,bridge,calls};
}
test('DE original helper executes eight complete callbacks and restores only entryXYZ plus horizontal0, retaining all other side effects',()=>{
 const {actor,bridge}=fixture([{found:true,lineIndex:3,point:[500,300,700]}]);const r=executeAddDePrediction2016(actor,bridge);
 assert.deepEqual(r.position,[500,400,700]);assert.deepEqual([actor.x,actor.y,actor.z],[10,1000,30]);assert.equal(actor.vx,0);assert.equal(actor.vy,-80);assert.equal(actor.hp,92);assert.equal(actor.cache,8);assert.equal(actor.pet.x,8);assert.equal(actor.pending.length,8);
});
test('DE second CanDown retains index written by first failure and accepts its success without first-query type/enabled gate',()=>{
 const {actor,bridge,calls}=fixture([{found:false,lineIndex:7,point:[8,9,10]},{found:true,lineIndex:8,point:[30,900,40]}]);bridge.lineAt=()=>({type:2,enabled:false});const r=executeAddDePrediction2016(actor,bridge);
 assert.equal(calls.length,2);assert.equal(calls[0].lineIndex,0);assert.equal(calls[1].lineIndex,7);assert.deepEqual(calls[1].position,[10,1000,30]);assert.deepEqual(r.position,[30,900,40]);
});
test('DE two failures use post-physics supportY, and incomplete position-only bridges are rejected before writes',()=>{
 const {actor,bridge}=fixture([{found:false,lineIndex:2,point:[0,0,0]},{found:false,lineIndex:3,point:[0,0,0]}]);assert.deepEqual(executeAddDePrediction2016(actor,bridge).position,[10,222,30]);
 assert.throws(()=>executeAddDePrediction2016(actor,{queryDown:()=>null}),/Complete target2016/);
});
