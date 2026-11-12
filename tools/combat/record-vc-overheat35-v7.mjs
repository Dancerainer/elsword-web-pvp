import fs from 'node:fs';
import {runDeadlyRaid,vcProductionPreset} from '../../tests/helpers/vc-production-fixture.mjs';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
const runs=[false,true].flatMap(awake=>[1,.3,.2].map(hpFraction=>{
  const options={awake,hpFraction,preset:{overheatHpCostMultiplier:35,overheatHpCostMultipliers:undefined,overheatSkillLayerHpCap:undefined,overheatHardProtection:false}};return {options,...runDeadlyRaid(options)};
}));
fs.writeFileSync('reports/vc-overheat35-v7.json',JSON.stringify({
  evidenceClass:'current-simulation; explicit user35x tuning, not original-client measurement',
  coreVersion:CORE_VERSION,presetVersion:vcProductionPreset.presetVersion,runs,
},null,2)+'\n');
console.log(runs.map(r=>({options:r.options,hpMax:r.initial.hpMax,cost:r.cost,percent:r.percentOfMax,penalties:r.penalties.length,activations:r.activationCount})));
