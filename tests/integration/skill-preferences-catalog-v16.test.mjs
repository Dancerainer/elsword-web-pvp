import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSkillPreferencesClient} from '../../apps/web/skill-preferences.mjs';
import {normalize} from '../../apps/server/skill-preferences.mjs';
import profile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};

test('actual UI catalog, account validator and client preserve every RF active and all 36 selectable branches',async()=>{
  const definitions=JSON.parse(readFileSync(new URL('../../artifacts/ui/skills/catalog.json',import.meta.url))).skills;
  const supportFor=id=>{const support=profile.skillCatalog.find(s=>s.skillId===id);
    return support&&preset.bannedSkillIds.includes(id)?{...support,supported:false,pvpDisabled:true}:support;};
  const active=profile.skillCatalog.filter(s=>s.unitClass===107&&s.supported&&!s.passive&&
    !preset.bannedSkillIds.includes(s.skillId)&&!profile.skillCatalog.some(t=>t.replacesSkillId===s.skillId));
  assert.equal(active.length,19);let branchCases=0;
  for(const skill of active){
    const branches=skill.branches.filter(b=>b.selectable!==false),ids=branches.length?branches.map(b=>b.id??b.branchId):['none'];
    for(const branchId of ids){
      if(branchId!=='none')branchCases++;
      const stored=normalize({loadout:[{skillId:skill.skillId,branchId},...Array(7).fill(null)],
        branchChoices:{[skill.skillId]:branchId}},profile,preset);
      const client=createSkillPreferencesClient({fetch:async(url,options)=>{
        assert.equal(url,'/api/skill-preferences');assert.equal(options.cache,'no-store');
        return {ok:true,status:200,json:async()=>({preferences:options.method==='GET'?stored:
          normalize(JSON.parse(options.body),profile,preset)})};
      }});
      const restored=await client.load({username:'fixture-catalog',defaults:preset.loadout,definitions,supportFor});
      assert.deepEqual(restored,stored,`Skill ${skill.skillId}, branch ${branchId} is retained across UI/server rules`);
      assert.deepEqual(await client.save(restored),stored);
    }
  }
  assert.equal(branchCases,36);
});
