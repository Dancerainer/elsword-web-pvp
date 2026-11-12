import test from 'node:test';
import assert from 'node:assert/strict';
import {skillLabel,skillDescription} from '../../packages/localization/skills.mjs';
test('RS display overlay uses original English names while preserving highest-upgrade prefix',()=>{
  for(const [id,name]of [[21405,'Thinking Outside the Box'],[21211,'Magic Counter'],[21018,'Splash Explosive'],[21604,'[Enhanced] Shining Rune Buster']]){
    const definition={id,classId:101,maxLevel:id===21405?4:1};
    assert.equal(skillLabel(definition),name);assert.ok(!skillDescription(definition).includes('undefined'));
  }
});
