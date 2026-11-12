import {UPDATE_LIMIT_MB} from './update-contract.mjs';

export function fullClientRequiredMessage(plan = {}) {
  const nextStep = ' Close the launcher and extract the full client package for this server.';
  if (plan.reason === 'unknown-base') return 'The server has no update registered for this client version.' + nextStep;
  if (plan.reason === 'over-limit') {
    const size = Number.isFinite(plan.bytes) ? ' (' + (plan.bytes / 1_000_000).toFixed(1) + ' MB)' : '';
    return 'This update' + size + ' exceeds the ' + UPDATE_LIMIT_MB + ' MB download limit.' + nextStep;
  }
  if (plan.reason === 'unsupported-base') return 'This update replaces components that require a full client package.' + nextStep;
  return 'This version requires the full client package.' + nextStep;
}
