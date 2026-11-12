import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
const native=await instantiateNativeSkillValues(readFileSync(process.argv[2]));
assert.equal(native.abilityValue({'1':300,'2':400,'3':500,'4':1000},4),1000);
assert.equal(native.abilityValue({'1':300},2),0);
assert.equal(native.abilityValue({'1':300},0),0);
assert.equal(native.powerRateValue({'1':1,'2':1.075},2),Math.fround(1.075));
assert.equal(native.increasingRate(1.12),Math.fround(Math.fround(Math.fround(1.12)-1)+Math.fround(.00005)));
assert.throws(()=>native.abilityValue({'1':1,'3':3},3),/contiguous/);
assert.equal(native.buffRelation(2000,-.3,.5),-300);
assert.equal(native.buffFixed(-300,.5),-150);
assert.equal(native.buffPercent(-.1,.5),Math.fround(-.05));
assert.deepEqual(native.buffInterval(.9,1,.2),{triggered:true,sum:0});
assert.deepEqual(native.buffInterval(0,1,2.5),{triggered:true,sum:0}); // one interval, discard remainder
console.log(JSON.stringify({ability4:1000,power2:native.powerRateValue({'1':1,'2':1.075},2),increasing112:native.increasingRate(1.12),buffRelation:native.buffRelation(2000,-.3,.5),buffFixed:native.buffFixed(-300,.5),buffPercent:native.buffPercent(-.1,.5),interval:native.buffInterval(.9,1,.2),cases:11}));
