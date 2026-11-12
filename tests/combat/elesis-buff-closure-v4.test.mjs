import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const ca=read('packages/combat-core/ca-profile.json'),bh=read('packages/combat-core/bh-profile.json');
const common=read('contracts/common-buff-catalog.json');

test('CA Punish has distinct original dungeon/PvP factors and a five-second iconless template',()=>{
  for(const [id,first,last] of [[479,1.15,1.44],[480,1.05,1.147]]){
    const raw=ca.buffFactors[id].raw;
    assert.equal(raw.BUFF_TEMPLET_ID,441);
    assert.equal(raw.BEHAVIOR.BBT_CHANGE_PHYSIC_ATTACK.PERCENT['1'],first);
    assert.equal(raw.BEHAVIOR.BBT_CHANGE_MAGIC_ATTACK.PERCENT['30'],last);
    assert.ok(Object.values(raw.FINALIZER.BFT_TIME.NORMAL_TIME).every(n=>n===5));
    assert.deepEqual(common.buffFactors[id].raw,raw);
  }
  assert.equal(ca.buffTemplates[441].raw.DISPLAYER,undefined);
  assert.equal(ca.buffTemplates[441].raw.BUFF_ICON_TEXTURE_NAME,undefined);
  assert.deepEqual(common.buffTemplates[441].raw,ca.buffTemplates[441].raw);
});
test('already-frozen BH pickup buffs and nonattacking Brandish placeholder retain their original identities',()=>{
  for(const [factor,template] of [[296,295],[297,296]]){
    assert.equal(bh.buffFactors[factor].raw.BUFF_TEMPLET_ID,template);assert.ok(bh.buffTemplates[template]);
  }
  const dummy=ca.damageEffects.DamageEffect_SA_SDK_BRANDISH_BREAKER_LOOP_DUMMY.raw;
  assert.equal(dummy.ATTACK_TIME_START,9999);assert.equal(dummy.ATTACK_TIME_END,9999);
  assert.ok(!ca.skillCatalog.some(row=>row.skillId===28032));
});
