import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import source from '../../contracts/profession-revival-source-v30.json' with {type:'json'};
import {PVP_RULE_VERSION} from '../../packages/pvp/index.mjs';
const text=file=>readFileSync(new URL('../../.cache/revival-source/'+file,import.meta.url));
const missingSource=file=>existsSync(new URL('../../.cache/revival-source/'+file,import.meta.url))?false:
  'Qualified revival source unavailable: .cache/revival-source/'+file;
test('revival audit seals the actual qualified references and keeps user Add policy separate',()=>{
  assert.equal(source.ruleVersion,PVP_RULE_VERSION);assert.equal(source.targetClientMeasured,false);
  assert.equal(source.add.leadingRawDp,2000);assert.equal(source.add.leadingNativeConsumerVerified,false);
  assert.match(source.add.ruleAuthority,/user correction/);assert.match(source.add.referenceFinding,/no matching/);
});
for(const row of source.referenceFiles)test(row.file+' qualified source matches its independent byte identity',{
  skip:missingSource(row.file),
},()=>{const bytes=text(row.file);assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);});
for(const file of ['X2GUElsword_SwordMan.cpp','X2GUEL.cpp'])test(file+' ReInit clears any own lead and ends nonleading active modes',{skip:missingSource(file)},()=>{
  const all=text(file).toString('latin1'),start=all.indexOf('::ReInit('),end=all.indexOf('\n}',start),body=all.slice(start,end);
  assert.match(body,/GetRedTeamKill\(\) > g_pX2Game->GetBlueTeamKill\(\)/);
  assert.match(body,/GetRedTeamKill\(\) < g_pX2Game->GetBlueTeamKill\(\)/);
  assert.match(body,/SetWayOfSwordPoint\( 0 \)/);assert.match(body,/WSS_CENTER/);
  assert.match(body,/End_SwordmanVigor\(\)[\s\S]*WSS_TOWARD_VIGOR/);
  assert.match(body,/End_SwordmanDestruction\(\)[\s\S]*WSS_TOWARD_DESTRUCTION/);
});
test('Add reference does not supply a leading fixed100 setter; old full clears are commented out',{skip:missingSource('X2GUAdd.cpp')},()=>{
  const all=text('X2GUAdd.cpp').toString('latin1'),start=all.indexOf('::ReInit('),body=all.slice(start,all.indexOf('\n}',start));
  const active=body.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  assert.match(body,/\/\/[^\n]*SetDPValue\( 0\.f \)/);assert.match(body,/\/\/[^\n]*SetMutationCount\( 0 \)/);
  assert.equal(/SetDPValue|SetMutationCount|GetRedTeamKill|GetBlueTeamKill/.test(active),false);
});
