import test from 'node:test';
import assert from 'node:assert/strict';
import {addVoidCollapseColor} from '../../apps/web/add-void-collapse-display-v57.mjs';
import {updateControlledEffectLookup} from '../../apps/web/render-preparation.mjs';
test('Void collapse remains in the actual presentation lookup although it has no literal-motion or posed-anchor marker',()=>{
  const field={id:1,name:'DamageEffect_ATT_Void_Field',sourceAddVoidCollapse:{scale:.5,alpha:.25}},plain={id:2};
  const lookup=updateControlledEffectLookup(new Map(),[field,plain]);assert.equal(lookup.get(1),field);assert.equal(lookup.has(2),false);
  updateControlledEffectLookup(lookup,[]);assert.equal(lookup.size,0);
});
test('the source alpha multiplier reaches both mesh and quad colors without altering authored color or existing ordinary particles',()=>{
  const color=[.25,1,.75,.8],field={sourceAddVoidCollapse:{scale:.5,alpha:.25}};
  assert.deepEqual(addVoidCollapseColor(color,field),[.25,1,.75,.2]);assert.deepEqual(color,[.25,1,.75,.8]);
  assert.equal(addVoidCollapseColor(color,null),color);field.sourceAddVoidCollapse.alpha=0;assert.equal(addVoidCollapseColor(color,field)[3],0);
});
