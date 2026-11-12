import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFESSIONS,normalizeProfessionFlags,effectiveProfessionFlags,selectEnabledProfession,isRavenProfession} from '../../packages/professions/catalog.mjs';
import {awakeningActorEligible,awakeningAttachmentsFor} from '../../apps/web/awakening-effects.mjs';
import {pvpMemberProfession} from '../../apps/web/pvp-hud.mjs';
import {collectProfessionImageUrls} from '../../apps/web/load-profession-assets.mjs';
import {supportsRavenClawTrail} from '../../apps/web/weapon-trails.mjs';

test('BM has its own native identity and portraits for local, ally and enemy HUD',()=>{
  assert.equal(PROFESSIONS.BM.unitClass,106);
  for(const player of [{professionId:'BM'},{actor:{professionId:'BM'}},{professionId:'BM',actor:{professionId:'RF'}}]){
    assert.equal(pvpMemberProfession(player).id,'BM');
    assert.equal(pvpMemberProfession(player).portraitUrl,'/assets/bm/ui/portrait-party.png');
  }
  const urls=collectProfessionImageUrls('BM',{skills:[{icon:'bm/blade.png'}]});
  for(const file of ['/assets/bm/ui/portrait-state.png','/assets/bm/ui/portrait-party.png','/assets/ui/raven_3.png','/assets/ui/raven_3_bg.png','/assets/ui/skills/bm/blade.png'])assert.ok(urls.includes(file),file);
  assert.ok(!urls.includes('/assets/ui/r_fist_state.png'));
});

test('BM awakening and weapon trails retain Raven source while excluding another profession owner',()=>{
  const profile={target:{unitClass:106}};
  assert.equal(isRavenProfession('BM'),true);assert.equal(isRavenProfession('LK'),false);
  assert.equal(supportsRavenClawTrail(profile),true);
  assert.equal(awakeningActorEligible(profile,{professionId:'BM'}),true);
  for(const professionId of ['RF','VC','LK'])assert.equal(awakeningActorEligible(profile,{professionId}),false);
  assert.ok(awakeningAttachmentsFor(profile).every(row=>row.template.endsWith('Black')));
  assert.equal(awakeningAttachmentsFor(profile).length,4);
});

test('legacy saved flags do not silently enable BM; explicit selection and all-off fallback are stable',()=>{
  const old={RF:false,LK:false,VC:true};
  assert.deepEqual(normalizeProfessionFlags(old),{RF:false,LK:false,VC:true,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.deepEqual(old,{RF:false,LK:false,VC:true});
  assert.equal(selectEnabledProfession('BM',old),'VC');
  assert.equal(selectEnabledProfession('BM',{...old,BM:true}),'BM');
  assert.deepEqual(effectiveProfessionFlags({RF:false,LK:false,VC:false,BM:false}),{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.throws(()=>normalizeProfessionFlags({RF:true,LK:true,BM:'true'}),/Invalid/);
  assert.throws(()=>normalizeProfessionFlags({RF:true,LK:true,OTHER:true}),/Invalid/);
});
