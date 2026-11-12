import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import source from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cached=file=>new URL('../../.cache/pvp-source/'+file,import.meta.url);
const ready=source.v5.files.every(f=>existsSync(cached(f.path)));

test('PvP contract separates source classes and every acquired V5 source has exact commit/blob/hash',()=>{
  assert.equal(source.targetClientMeasured,false);assert.equal(source.v5.commit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  assert.equal(source.serverReference.dirtySnapshot,true);
  for(const f of source.v5.files){
    assert.match(f.sha256,/^[0-9a-f]{64}$/);assert.match(f.gitBlob,/^[0-9a-f]{40}$/);
    assert.equal(f.repositoryPath,'JP_TW_EU_CN_US/Trunk/'+f.path);assert.ok(f.bytes>0);
  }
  assert.match(source.respawn.position,/User customization/);
  assert.match(source.victory.simultaneous,/Host adaptation/);
  assert.match(source.kda.assist,/Host adaptation/);
  assert.equal(source.outnumbered.attackDamageBonus,false);
});

test('independently acquired source bytes and Git blob hashes match frozen evidence',{skip:!ready},()=>{
  for(const f of source.v5.files){
    const bytes=readFileSync(cached(f.path));assert.equal(bytes.length,f.bytes,f.path);assert.equal(hash(bytes),f.sha256,f.path);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),f.gitBlob,f.path);
  }
});

test('read-only target declaration and server reference snapshot bytes match contract',{skip:![...source.targetSources,...source.serverReference.files.map(f=>({...f,path:'asset_sources/upstream/server/'+f.path}))].every(f=>existsSync(f.path))},()=>{
  for(const f of source.targetSources)assert.equal(hash(readFileSync(f.path)),f.sha256,f.path);
  for(const f of source.serverReference.files)assert.equal(hash(readFileSync('asset_sources/upstream/server/'+f.path)),f.sha256,f.path);
  const enumContract=JSON.parse(readFileSync(new URL('../../'+source.enumContract.path,import.meta.url)));
  assert.deepEqual(enumContract.sources['Enum.lua'],source.enumContract.enumSource);
  assert.deepEqual(enumContract.pvpRevengeIds,source.enumContract.resolvedRevengeIds);
});

test('V5 independent literals support duration, intro, received MP and result priority',{skip:!ready},()=>{
  const text=file=>readFileSync(cached(file)).toString('latin1');
  const match=text('KncWX2Server/ServerResource/PvpMatchData.lua');
  assert.ok(/AddPvpMatchInfo\( MATCH_TYPE\["MT_TEAM_DEATH_2_ON_2"\],\s*4,\s*420 \)/.test(match),'Literal4/420 match configuration');
  const user=text('X2Lib/X2GUUser.cpp');
  assert.ok(/StartEventProcess\(\)[\s\S]{0,200}EVENT_TIME = 4\.5f/.test(user),'Native4.5 intro consumer');
  assert.ok(/SetBasicStatValueChargeMpHitted\( \(3\.0f \+ \(2\.0f \* teamAdv\)\) \* fIncreaseMpRate \)/.test(user),'Received MP original consumer');
  const slow=text('X2Lib/X2PVPGameTeamDeath.cpp');assert.ok(/SlowFrame\(\s*0\.2f,\s*1\.5f\s*\)/.test(slow),'Last-kill slowdown');
  const result=text('KncWX2Server/CenterServer/ResultProcess.cpp');
  assert.ok(result.includes('IsDie() ? 100'));assert.ok(result.includes('GetPercentHP()'));
  assert.ok(result.includes('DecidePVPWinTeam'));
  const teams=text('KncWX2Server/Common/X2Data/XSLRoom.h');
  assert.ok(/TN_RED\s*=\s*0/.test(teams));assert.ok(/TN_BLUE\s*=\s*1/.test(teams));
});
