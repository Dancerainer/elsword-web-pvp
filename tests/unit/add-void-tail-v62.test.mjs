import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddVoidCollapseDisplay,createAddVoidCollapseDisplayRegistry,updateAddVoidCollapseDisplay,addVoidCollapseColor} from '../../apps/web/add-void-collapse-display-v57.mjs';
test('Void display keeps progressively applied values and its final zero after the carrier lookup retires',()=>{
 const color=[.2,.4,.6,.8],display=createAddVoidCollapseDisplay(null);
 for(const alpha of [.97,.76,.43,.1,0]){
  const source={sourceAddVoidCollapse:{scale:.5,alpha}};
  updateAddVoidCollapseDisplay(display,source);
  assert.equal(addVoidCollapseColor(color,source,display)[3],.8*alpha);
 }
 assert.equal(addVoidCollapseColor(color,null,display)[3],0);assert.deepEqual(color,[.2,.4,.6,.8]);
});
test('Void local-id reconstruction shares the actual cast display, isolates epochs/owners, and releases dead emitter records',()=>{
 const registry=createAddVoidCollapseDisplayRegistry(),parent={id:1,ownerId:'add',ownerStateSerial:4};
 const first=registry.acquire(parent,{id:1,ownerStateSerial:4});registry.track(first,10);
 const restored=registry.acquire({...parent,id:12},{id:12,networkId:1,networkEpoch:1,ownerStateSerial:4,sourceAddVoidCollapse:{alpha:.4}});
 assert.equal(first,restored);registry.track(restored,11);updateAddVoidCollapseDisplay(restored,{sourceAddVoidCollapse:{alpha:0}});assert.equal(first.alpha,0);
 const nextEpoch=registry.acquire({...parent,id:20},{id:20,networkId:1,networkEpoch:2,ownerStateSerial:4});
 const otherOwner=registry.acquire({...parent,ownerId:'other'},{networkId:1,networkEpoch:1,ownerStateSerial:4});
 assert.notEqual(first,nextEpoch);assert.notEqual(first,otherOwner);assert.equal(nextEpoch.alpha,1);
 registry.track(nextEpoch,20);registry.prune(new Map([[20,{}]]));assert.equal(registry.size,1);
 registry.prune(new Map());assert.equal(registry.size,0);registry.clear();
});
test('Void terminal zero cannot be reopened by an older source packet, and another cast has independent color state',()=>{
 const ended=createAddVoidCollapseDisplay({sourceAddVoidCollapse:{scale:.3,alpha:0}}),next=createAddVoidCollapseDisplay(null);
 updateAddVoidCollapseDisplay(ended,{sourceAddVoidCollapse:{scale:.8,alpha:.7}});
 assert.equal(addVoidCollapseColor([1,1,1,1],{sourceAddVoidCollapse:{scale:.8,alpha:.7}},ended)[3],0);
 assert.equal(addVoidCollapseColor([1,1,1,1],null,next)[3],1);
 assert.equal(addVoidCollapseColor([1,1,1,1],null)[3],1);
});
test('Void shared old and restored local handles retain one record until their actual emitters have both retired',()=>{
 const registry=createAddVoidCollapseDisplayRegistry(),parent={id:1,ownerId:'add',ownerStateSerial:4};
 const old=registry.acquire(parent,{networkEpoch:1,ownerStateSerial:4,sourceAddVoidCollapse:{alpha:.4}});
 registry.track(old,10);
 const restored=registry.acquire({...parent,id:12},{networkId:1,networkEpoch:1,ownerStateSerial:4,sourceAddVoidCollapse:{alpha:0}});
 registry.track(restored,11);assert.equal(old,restored);
 registry.prune(new Map([[10,{}],[11,{}]]));assert.equal(registry.size,1);assert.equal(old.emitters.size,2);
 registry.prune(new Map([[11,{}]]));assert.equal(registry.size,1);assert.deepEqual([...old.emitters],[11]);assert.equal(old.alpha,0);
 registry.prune(new Map());assert.equal(registry.size,0);assert.equal(old.emitters.size,0);
});
