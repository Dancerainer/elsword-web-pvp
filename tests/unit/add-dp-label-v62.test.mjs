import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {withAddResourceNumberStyles,emitAddResourceRecoveryNumbers} from '../../apps/web/damage-number-layout.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const source=read('contracts/add-dp-popup-v62.json'),original=read('artifacts/ui/damage-numbers/manifest.json');
test('DP original text producer and original D atlas asset are positive source evidence, not a missing-Web-glyph inference',()=>{
 assert.equal(source.dpFormat.value,'DP+ %d');assert.equal(source.glyph.textureId,68);
 assert.equal(source.glyph.sha256,'c65a94379abeee950aae9a273d5cd06df0108a61f8485032b8027c851faa1ad4');
 assert.equal(original.glyphs.D.source.sha256,source.glyph.sha256);
 const png=readFileSync(new URL('../../artifacts/ui/damage-numbers/'+original.glyphs.D.file,import.meta.url));
 assert.equal(createHash('sha256').update(png).digest('hex'),original.glyphs.D.sha256);
 assert.equal(original.glyphs.D.width,32);assert.equal(original.glyphs.D.height,32);
});
test('positive actual DP recovery draws centered red DP+ text, never rawDP or declared costs; MP stays blue',()=>{
 const manifest=withAddResourceNumberStyles(original),rows=[],runtime={particles:new Map(),emitParticle(name,options){rows.push({name,...options});return true;}};
 const event={type:'addOverlimitResourceRecovered',resource:'DP',amount:3.75,rawAmount:75,declaredAmount:999,position:[100,500,4]};
 assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,event),4);assert.equal(rows.map(r=>r.digit).join(''),'DP+3');
 assert.ok(rows.every(r=>r.style==='dp'&&r.name==='PicCharRed'&&r.position[1]===500));
 assert.deepEqual(rows.map(r=>r.position[0]),[35,61,87,139]);
 rows.length=0;emitAddResourceRecoveryNumbers(runtime,manifest,{...event,resource:'MP'});
 assert.equal(rows.map(r=>r.digit).join(''),'MP+3');assert.ok(rows.every(r=>r.style==='mp'&&r.name==='PicCharBlue'));
 for(const amount of [0,-1,Infinity,NaN])assert.equal(emitAddResourceRecoveryNumbers(runtime,manifest,{...event,amount}),0);
});
