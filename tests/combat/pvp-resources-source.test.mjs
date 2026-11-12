/** Independent fixed-source assertions; no observed simulation becomes an
 * alleged target-client answer. The special-pool policy is a user extension.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import resource from '../../contracts/rf-pvp-resources-source-v3.json' with {type:'json'};
import rules from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};
import reaction from '../../contracts/rf-reaction-source.json' with {type:'json'};
const root=new URL('../../',import.meta.url);
const ready=resource.referenceFiles.every(f=>existsSync(new URL(f.cachePath,root)));
const text=path=>readFileSync(new URL(resource.referenceFiles.find(f=>f.path===path).cachePath,root)).toString('latin1');
const functionText=(source,name)=>{
  const start=source.indexOf('void '+name+'(');assert.ok(start>=0,name);
  const end=source.indexOf('\nvoid ',start+1);return source.slice(start,end<0?undefined:end);
};

test('resource source contract distinguishes seasonal MP evidence from user extension and unsupported RF pools',()=>{
  assert.equal(resource.targetClientMeasured,false);assert.equal(resource.referenceCommit,rules.v5.commit);
  assert.equal(resource.referenceCommit,reaction.referenceCommit);
  assert.equal(resource.ruleVersion,'rf-2v2-reference-v3');
  assert.deepEqual(resource.specialResourceRegistration.rfSupportedPools,[]);
  assert.equal(resource.awakening.penalizedByScore,false);assert.equal(resource.ravenCore.registeredSpecialResource,false);
  assert.match(resource.retention.specialResourceEvidence,/User-requested extension/);
  assert.match(resource.awakening.gauge,/static source inference/);
  assert.equal(rules.respawn.resourcesContract,'contracts/rf-pvp-resources-source-v3.json');
  for(const file of resource.referenceFiles){
    const prior=reaction.referenceFiles.find(f=>f.path==='JP_TW_EU_CN_US/Trunk/'+file.path);
    assert.ok(prior,file.path);
    for(const key of ['sha256','gitBlob','bytes'])assert.equal(file[key],prior[key],file.path+' '+key);
  }
});

test('resource sources retain independently frozen hashes and Git blob framing',{skip:!ready},()=>{
  for(const f of resource.referenceFiles){
    const bytes=readFileSync(new URL(f.cachePath,root));assert.equal(bytes.length,f.bytes,f.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),f.gitBlob,f.path);
  }
});

test('fixed V5 seasonal revival preserves Soul current storage and orbs; active hyper/core reset separately',{skip:!ready},()=>{
  const user=functionText(text('X2Lib/X2GUUser.cpp'),'CX2GUUser::ReInit');
  const seasonal=user.match(/#ifdef PVP_SEASON2([\s\S]*?)#else([\s\S]*?)#endif/);assert.ok(seasonal);
  assert.match(seasonal[1],/1 < iDiffKillNum[\s\S]*SetNowMp\( 0\.f \)/);
  assert.match(seasonal[1],/iDiffKillNum == 1[\s\S]*SetNowMp\( GetNowMp\(\) \* 0\.5f \)/);
  assert.equal(seasonal[1].includes('SetNowSoul'),false);
  assert.equal((seasonal[2].match(/SetNowSoul\( 0\.f \)/g)??[]).length,2,'Old branch is not seasonal policy');
  assert.match(user,/int hyperModeCount = GetHyperModeCount\(\)/);assert.match(user,/SetHyperModeCount\( hyperModeCount \)/);
  const gameUnit=text('X2Lib/X2GameUnit.h'),gage=text('X2Lib/X2GageData.h');
  assert.match(gameUnit,/float GetNowSoul\(\) const \{ return GetGageData\(\)->GetNowSoul\(\); \}/);
  assert.match(gameUnit,/void SetMaxSoul\( const float maxSoul \) \{ GetGageData\(\)->SetMaxSoul\( maxSoul \); \}/);
  assert.match(gage,/GetNowSoul\(\) const \{ return m_SoulGage\.fNow; \}/);
  assert.match(gage,/SetMaxSoul\( const float fMaxSoul_ \) \{ m_SoulGage\.fMax = fMaxSoul_; \}/);
  const base=functionText(text('X2Lib/X2GameUnit.cpp'),'CX2GameUnit::ReInit');
  assert.match(base,/SetRemainHyperModeTime\( 0\.0f \)/);
  assert.equal(/m_pGageData|CreateGageData|SetNowSoul/.test(base),false,'ReInit does not reset persistent GageData/Soul');
  const raven=functionText(text('X2Lib/X2GURaven.cpp'),'CX2GURaven::ReInit');
  assert.match(raven,/m_iNaosdBallLv = 0/);assert.match(raven,/m_fRageGauge = 0\.f/);
  assert.equal(/iDiffKillNum|GetRedTeamKill|GetBlueTeamKill/.test(raven),false,'Core reset is not tied to score');
});
