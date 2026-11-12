import test from 'node:test';
import assert from 'node:assert/strict';
import {fullClientRequiredMessage} from '../../apps/local-client/update-messages.mjs';
test('unregistered full client explains the missing update origin without claiming a size overflow',()=>{
 const text=fullClientRequiredMessage({reason:'unknown-base'});assert.match(text,/no update registered/);assert.ok(!text.includes('MB download limit'));
});
test('real size limit and component replacement are explained separately',()=>{
 assert.match(fullClientRequiredMessage({reason:'over-limit',bytes:105_100_000}),/105\.1 MB\) exceeds the 100 MB download limit/);
 assert.match(fullClientRequiredMessage({reason:'unsupported-base'}),/replaces components/);
});
