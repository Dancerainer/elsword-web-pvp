import test from 'node:test';
import assert from 'node:assert/strict';
import {AddChaserTrail} from '../packages/presentation/add-chaser-trail-v61.mjs';
import source from '../contracts/mm-chaser-trail-v61.json' with {type:'json'};
test('constant-width reference consumer keeps measured helper radius while moving and uses tough curve within100 vertices',()=>{
 const trail=new AddChaserTrail();for(let i=1;i<=90;i++)trail.step({dt:1/60,up:[i*60,-12,0],down:[i*60,12,0],direction:[1,0,0]});
 assert.ok(trail.buffer.pairs.length<=50);// Source constant-width projects before the tough-curve spline; its known
 // Down4=Up4 control reference can distort later interpolated pair width.
 const up=trail.buffer.upHistory[3],down=trail.buffer.downHistory[3];assert.ok(Math.abs(Math.hypot(...up.map((n,i)=>n-down[i]))-24)<1e-6);
 const g=trail.geometry();assert.ok(g.positions.length<=300);assert.equal(g.uvs.length,g.positions.length/3*2);assert.equal(g.uvs[1],0);assert.equal(g.uvs[3],1);
 assert.equal(source.consumer.curveType,1);assert.equal(source.consumer.drawCount,1);assert.equal(source.texture.sha256,'a2457224b10917f7d536cc6bde640943af41995493f15a1cffde4a5092ee72f1');
});
test('reference texture fade clips below .1 and deactivated samples cannot leave persistent visible strips',()=>{
 const trail=new AddChaserTrail();for(let i=0;i<10;i++)trail.step({dt:1/60,up:[i*60,-12,0],down:[i*60,12,0],direction:[1,0,0]});
 for(let i=0;i<40;i++)trail.step({dt:1/60,up:[600,-12,0],down:[600,12,0],direction:[1,0,0],active:false});assert.equal(trail.buffer.visible,false);
});
