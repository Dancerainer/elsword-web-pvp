import test from 'node:test';
import assert from 'node:assert/strict';
import {configureAssetUrls,assetUrl,initializeAssetUrls,versionStyleSheetAssets} from '../../apps/web/asset-urls.mjs';
const first='a'.repeat(64),second='b'.repeat(64);
test('only known same-origin assets receive stable content hashes and existing query/hash are preserved',()=>{
  configureAssetUrls({'scene/map/scene.glb':first,'rf/texture.png':second});
  assert.equal(assetUrl('/assets/scene/map/scene.glb'),'/assets/scene/map/scene.glb?v='+first);
  assert.equal(assetUrl('/assets/rf/texture.png?view=a#pixel'),'/assets/rf/texture.png?view=a&v='+second+'#pixel');
  assert.equal(assetUrl('/assets/rf/texture.png?v=old'),'/assets/rf/texture.png?v='+second);
  assert.equal(assetUrl('https://other.invalid/assets/rf/texture.png'),'https://other.invalid/assets/rf/texture.png');
  assert.equal(assetUrl('/api/session'),'/api/session');assert.equal(assetUrl(null),null);
});
test('code-only reinitialization preserves resource URLs; one changed resource replaces only its own URL',()=>{
  configureAssetUrls({'rf/texture.png':first,'rf/pose.json':second});const texture=assetUrl('/assets/rf/texture.png'),pose=assetUrl('/assets/rf/pose.json');
  configureAssetUrls({'rf/texture.png':first,'rf/pose.json':second});assert.equal(assetUrl('/assets/rf/texture.png'),texture);
  configureAssetUrls({'rf/texture.png':second,'rf/pose.json':second});assert.notEqual(assetUrl('/assets/rf/texture.png'),texture);assert.equal(assetUrl('/assets/rf/pose.json'),pose);
});
test('invalid version inventory cannot partially replace a previously valid inventory',()=>{
  configureAssetUrls({'rf/texture.png':first});
  for(const files of [null,[],{'../outside.png':first},{'/absolute.png':first},{'rf\\outside.png':first},{'rf/x.png':'wrong'}])assert.throws(()=>configureAssetUrls(files),/invalid-asset-version/);
  assert.equal(assetUrl('/assets/rf/texture.png'),'/assets/rf/texture.png?v='+first);
});
test('login initialization requests no-store authenticated inventory and rejects HTTP/schema failures',async()=>{
  const calls=[];await initializeAssetUrls(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({schemaVersion:1,files:{'rf/texture.png':first}})};});
  assert.deepEqual(calls,[{url:'/api/asset-versions',options:{cache:'no-store'}}]);
  await assert.rejects(initializeAssetUrls(async()=>({ok:false,status:401})),/HTTP 401/);
  await assert.rejects(initializeAssetUrls(async()=>({ok:true,json:async()=>({schemaVersion:2})})),/invalid-asset-versions/);
});
test('CSS resource URLs inside nested rules are versioned without losing property priorities',()=>{
  configureAssetUrls({'rf/texture.png':first});let value='url("/assets/rf/texture.png") center / contain no-repeat',priority;
  const style={*[Symbol.iterator](){yield 'background';},getPropertyValue:()=>value,getPropertyPriority:()=> 'important',setProperty(name,next,nextPriority){assert.equal(name,'background');value=next;priority=nextPriority;}};
  versionStyleSheetAssets({styleSheets:[{cssRules:[{cssRules:[{style}]}]}]});assert.ok(value.includes('?v='+first));assert.equal(priority,'important');
});
