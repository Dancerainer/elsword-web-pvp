/** Frozen 40/23 equipment input for the historical timestamped command traces.
 * Current production gear is exercised separately by source-equipment tests. */
import preset from '../../config/rf-preset.json' with {type:'json'};
import {authoredEquipmentPreset} from './authored-equipment-v21.mjs';
import * as dash from '../../tools/combat/rf_dash_zx_audit.mjs';
import * as down from '../../tools/combat/rf_down_z_audit_v14.mjs';
import * as jump from '../../tools/combat/rf_jump_cancel_v18.mjs';
import * as cancel from '../../tools/combat/rf_double_cancel_v19.mjs';
const options = value => ({...value,presetOverride:authoredEquipmentPreset(preset)});
export const dashZxFixture = value => dash.dashZxFixture(options(value));
export const downZFixture = value => down.downZFixture(options(value));
export const observeDownZ = value => down.observeDownZ(options(value));
export const observeJumpPrefix = (value,factory) => jump.observeJumpPrefix(options(value),factory);
export const observeDoubleCancelV19 = value => cancel.observeDoubleCancelV19(options(value));
export const observePreinputV19 = value => cancel.observePreinputV19(options(value));
export const {dashZxFrame,startDashZx} = dash;
export const {startDownZ} = down;
export const {jumpPressEdges} = jump;
export const {verifyDoubleCancelReplay} = cancel;
