import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectEffectTemplates,collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../../'+name,import.meta.url)));
const profile=read('packages/combat-core/bm-profile.json'),index=read('artifacts/bm/fx/index.json');

test('BM Shadow X prewarms original bullet impact and ground flame textures before the callback',()=>{
  const warmed=collectEffectTemplates(profile,index,[{skillId:24217}]);
  for(const effect of ['DAMAGE_EFFECT_SHADOW_BURSTER_EXPLOSION','DAMAGE_EFFECT_SHADOW_BURSTER_Flame_Damage']){
    for(const [key,entry]of Object.entries(profile.damageEffects[effect].raw))
      if(/^PASSIVE_PARTICLE\d+$/.test(key))assert.ok(warmed.has(entry.PARTICLE_NAME),entry.PARTICLE_NAME);
  }
  assert.ok(warmed.has('Raven_DashJumpAttackX01'),'shared Raven airborne callback already belongs to source literal closure');
});

test('BM HA prewarms both original same-named registries and reserves the mesh variant',()=>{
  const budget=collectEffectMeshBudget(profile,index,[{skillId:24604}]);
  const name='EffectSet_RBM_HYPER_STEP_EXPLO_P13';
  assert.ok(budget.templates.has(name));assert.ok(budget.templates.has('mesh::'+name));
  assert.equal(budget.demands.get('mesh::'+name)?.views,1);
});

test('BM physical XX prewarms both target air command sets without selecting a skill',()=>{
  const warmed=collectEffectTemplates(profile,index,[]);
  for(const name of ['RBM_DashJump_X_AttackBox','RST_DashJumpX_AP01','RuneGuardIce_S05','RST_DashJump_XZ_ProDummy',
    'RST_ShockWave_Pro04','RST_ShockWave_Pro01','RST_ShockWave_Pro02','RST_ShockWave_Pro01D','RST_ShockWave_Pro03'])
    assert.ok(warmed.has(name),name);
});
