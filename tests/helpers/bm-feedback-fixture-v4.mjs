/** Project rule uses the current production equipment preset.
 * Historical BM suites retain their explicit beforeBalanceV3 fixture. */
import {readFileSync} from 'node:fs';
import {bmFixture as historicalFixture,bmProfile} from './bm-fixture.mjs';
import {bmSampledFixture as historicalSampled} from './bm-sampled-commands-v2.mjs';
export const feedbackBmPreset=JSON.parse(readFileSync(new URL('../../config/bm-preset.json',import.meta.url)));
export {bmProfile};
export const bmFixture=options=>historicalFixture({...options,preset:feedbackBmPreset});
export const bmSampledFixture=options=>historicalSampled({...options,preset:feedbackBmPreset});
