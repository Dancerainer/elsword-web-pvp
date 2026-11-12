import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dashZxFixture} from '../../tools/combat/rf_dash_zx_audit.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('fixed native Init explicitly disables both feet and the auxiliary hand',()=>{
  const cpp=read('.cache/native-source-runtime/X2Lib/X2GUUser.cpp').replace(/\r\n/g,'\n');
  assert.ok(cpp.includes('SetEnableAttackBox( L"Rfoot", false );\n\tSetEnableAttackBox( L"Lfoot", false );\n\tSetEnableAttackBox( L"Lhand2", false );'));
});
test('8Z keeps the sword only; auxiliary boxes do not hit a rear touching enemy',async()=>{
  for(const facing of [-1,1]){
    const f=await dashZxFixture({facing,gap:-70}),{s,a,b}=f;
    a.grounded=false;a.y+=20;s.enter(a,'RSI_JUMP_COMBO_Z');a.animationTime=.14;
    const raw=s.profile.states[a.state].raw,shapes=s.collisionSampler(a,{raw});
    assert.ok(shapes.length);assert.ok(shapes.every(x=>x.source.helper.includes('Sword')));
    const rearHits=s.checkHits(a,shapes,raw.DAMAGE_DATA,{}, {kind:'character',id:'pose-8Z',powerMultiplier:1});
    assert.equal(rearHits,0,'source boxes + original helper intersection, not a blanket facing gate');
    assert.equal(b.hp,b.hpMax);
  }
});
test('explicit ENABLE_ATTACK_BOX restores auxiliary boxes; DISABLE wins',async()=>{
  const {s,a}=await dashZxFixture();
  let shapes=s.collisionSampler(a,{raw:{ENABLE_ATTACK_BOX:{1:'Lhand2',2:'Rfoot'}}});
  assert.ok(shapes.some(x=>x.source.helper.endsWith('Lhand2')));assert.ok(shapes.some(x=>x.source.helper.endsWith('Rfoot')));
  shapes=s.collisionSampler(a,{raw:{ENABLE_ATTACK_BOX:{1:'Lhand2'},DISABLE_ATTACK_BOX:{1:'Lhand2'}}});
  assert.ok(!shapes.some(x=>x.source.helper.endsWith('Lhand2')));
});
