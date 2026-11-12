/** Shared lobby policy. Combat limits are interpreted by the battle driver. */
export const ONLINE_MODES = Object.freeze(['1v1', '2v2', '3v3']);
export const MODE_CONFIG = Object.freeze({
  '1v1': Object.freeze({teamSize: 1, playerCount: 2, scoreLimit: 1, queueBaseSeconds: 5, fixedQueueWait: true}),
  '2v2': Object.freeze({teamSize: 2, playerCount: 4, scoreLimit: 4, queueBaseSeconds: 15, fixedQueueWait: false}),
  '3v3': Object.freeze({teamSize: 3, playerCount: 6, scoreLimit: 6, queueBaseSeconds: 17, fixedQueueWait: false}),
});
export const DEFAULT_MODE_FLAGS = Object.freeze(Object.fromEntries(ONLINE_MODES.map(mode => [mode, true])));
export const isOnlineMode = mode => ONLINE_MODES.includes(mode);
export function queueWaitSeconds(mode, eligibleCount) {
  const spec = MODE_CONFIG[mode];
  if (!spec) throw Error('invalid-online-mode');
  return spec.fixedQueueWait ? spec.queueBaseSeconds : Math.max(0, spec.queueBaseSeconds - eligibleCount);
}
