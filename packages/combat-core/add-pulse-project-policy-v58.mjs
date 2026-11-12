import {payAddPulseMaintenance2016} from './add-pulse-cannon-2016.mjs';

/** V58 user-authorized project rule from both target skill descriptions:
 * additional held shots cost25MP. The original formed local10 DP argument
 * remains unknown; this does not assign it a neighbouring500/400 value.
 * An explicitly supplied original instance provider retains admission priority.
 */
export function payAddPulseHeldMaintenance(sim,actor){
 if(!actor.sourceAdd?.formation||typeof sim.addPulseMaintenanceInput==='function'||
    actor.professionId!=='LP'||![29006,29034].includes(actor.skillId))
  return payAddPulseMaintenance2016(sim,actor);
 if(!(actor.mp>=25))return false;
 actor.mp=Math.fround(actor.mp-25);
 sim.emit?.('addPulseMaintenancePaid',actor.id,{skillId:actor.skillId,resource:'MP',amount:25,
  completedLoops:actor.sourceAddCombat?.pulseCount,policy:'v58-user-authorized-skill-description',
  evidence:'Original descriptions29006/29034 state25MP per extra shot; original formed local10 remains unresolved'});
 return true;
}
