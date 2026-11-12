import {MODE_CONFIG} from './modes.mjs';

/** One bounded poll response may retain reliable event history plus the latest
 * state for every remote actor and one ordinary room snapshot. */
export const ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS = 128;
export const ONLINE_POLL_MAXIMUM_REPLACEABLE_EVENTS = Math.max(...Object.values(MODE_CONFIG).map(mode => mode.playerCount));
export const ONLINE_POLL_MAXIMUM_BATCH_EVENTS = ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS + ONLINE_POLL_MAXIMUM_REPLACEABLE_EVENTS;
