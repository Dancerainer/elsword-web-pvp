import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runDeadlyRaid,vcProductionPreset} from '../../tests/helpers/vc-production-fixture.mjs';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const runs=[false,true].flatMap(awake=>[1,.25,.21,.20].map(hpFraction=>{
  const options={awake,hpFraction};return {options,...runDeadlyRaid(options)};
}));
const failures=runs.filter(r=>r.penalties.some(p=>p.hpCostMultiplier!==25||p.kind!=='skill'||p.layerSpent>r.initial.hpMax*.15)
  ||r.initial.hp/r.initial.hpMax<=.21&&r.cost!==0||r.initial.hp/r.initial.hpMax>.21&&r.finalHp<r.initial.hpMax*.21-.02);
writeFileSync('reports/vc-overheat-guards-v8.json',JSON.stringify({
  evidenceClass:'current-native-web-simulation; explicit user tuning, not original-client measurement',
  targetClientMeasured:false,coreVersion:CORE_VERSION,presetVersion:vcProductionPreset.presetVersion,
  hashes:{core:hash('packages/combat-core/index.mjs'),preset:hash('config/vc-preset.json'),skills:hash('packages/combat-core/vc-skills.mjs')},
  rules:{multipliers:vcProductionPreset.overheatHpCostMultipliers,skillLayerHpCap:.15,passiveHardFloor:.21,
    layerSemantics:'each accepted heat tier; multiple extension callbacks within one cast share a tier budget; Deadly Raid has three distinct tiers'},
  summary:{cases:runs.length,passed:runs.length-failures.length},runs,
},null,2)+'\n');
console.log(JSON.stringify({cases:runs.length,failures:failures.length,runs:runs.map(r=>({options:r.options,hpMax:r.initial.hpMax,cost:r.cost,percent:r.percentOfMax,penalties:r.penalties.length,activations:r.activationCount}))}));
if(failures.length)process.exitCode=1;
