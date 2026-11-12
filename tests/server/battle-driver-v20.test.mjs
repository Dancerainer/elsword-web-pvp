/** Real sealed native modules and production four-player driver after v20 merge.
 * This verifies web integration, not a measured original-client trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {normalize} from '../../apps/server/skill-preferences.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};

test('real online driver loads sourced80 equipment, RF/guild grants, per-player skills and frozen host/native seals',async t=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),assetRoot=process.env.RF_ASSET_ROOT??path.join(root,'artifacts');
  const factory=await createBattleDriverFactory({root,assetRoot});
  assert.equal(typeof factory,'function','complete sealed native/resource inputs required');
  const nativeManifest=JSON.parse(await readFile(path.join(assetRoot,'native/manifest.json'),'utf8'));
  const equipped=normalize({loadout:[{skillId:24027},...Array(7).fill(null)],branchChoices:{}},profile,preset);
  const empty=normalize({loadout:Array(8).fill(null),branchChoices:{}},profile,preset);
  const players=['r0','r1','b0','b1'].map((id,i)=>({id,username:id,team:i<2?0:1,...structuredClone(i===0?equipped:empty)}));
  const versions={...factory.versions,preset:factory.versions.presetSha256,browserBuildVersion:'distinct-browser-fixture'};
  const match={id:'v20-real-host',players,seed:20161008,versions};
  const driver=await factory({match,emit(){},finish(){throw Error('fresh match cannot settle');}});
  t.after(()=>driver.stop());
  const initial=driver.snapshot();
  assert.equal(initial.snapshot.actors.length,4);
  for(const actor of initial.snapshot.actors){
    assert.equal(actor.hpMax,248160);
    // v26 user override adds12 percentage points to the original25% option.
    // The native coefficient is a Float32; this is the explicit37% policy.
    assert.equal(actor.stats.animationSpeedMultiplier,Math.fround(1.37));
    assert.equal(actor.formulaRules.combatLevel,85);assert.equal(actor.equipmentAttributes.mpMax,30);assert.equal(actor.mpMax,330);
    assert.ok(Math.abs(actor.stats.moveSpeedMultiplier-1.125)<1e-6);
    assert.ok(Math.abs(actor.stats.jumpSpeedMultiplier-1.125)<1e-6);
    assert.equal(actor.stats.damageReduction,.40);assert.equal(actor.stats.awakeningChargeBonus,.3);
    assert.deepEqual(actor.passives,[24400,24401,24402,24403,24404,24405]);
    assert.deepEqual(Object.keys(actor.guild.levels).map(Number),Array.from({length:12},(_,i)=>500+i));
    assert.ok(Object.values(actor.guild.levels).every(level=>level===5));
    assert.equal(actor.stats.physicalAttack,1808);
    assert.equal(actor.stats.magicAttack,Math.fround(Math.fround(1667)*Math.fround(1.075)));
  }
  assert.equal(initial.snapshot.actors[0].loadout[0].skillId,24027);
  assert.ok(initial.snapshot.actors.slice(1).every(actor=>actor.loadout.every(slot=>slot===null)));
  for(const published of [initial.snapshot.versions,initial.pvp.versions]){
    for(const field of ['program','hostProgramSha256','resourceSha256','nativeProgram','presetVersion','coreVersion','profileSha256','presetSha256','nativeManifestSha256'])
      assert.equal(published[field],factory.versions[field],field);
    assert.equal(published.program,published.hostProgramSha256);assert.equal(published.coreVersion,CORE_VERSION);
    assert.equal(published.presetVersion,'rf-six-equipment-action-speed-v26-feedback-v45');
    assert.equal(published.nativeProgram,nativeManifest.seal.manifestContentSha256);
    assert.equal(published.browserBuildVersion,'distinct-browser-fixture');
  }
  for(const player of players)driver.ready(player.id);
  assert.equal(driver.snapshot().pvp.phase,'intro');
});
