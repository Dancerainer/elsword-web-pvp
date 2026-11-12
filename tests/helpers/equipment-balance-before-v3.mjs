/** Explicit legacy equipment inputs for historical arithmetic/behavior cases.
 * Current production is validated independently in equipment-balance-v3. */
import history from '../fixtures/equipment-balance-before-v3.json' with {type:'json'};
export function beforeBalanceV3(preset){const old=history[preset.career];return old?{...preset,presetVersion:old.presetVersion,attributes:{...old.attributes}}:preset;}
