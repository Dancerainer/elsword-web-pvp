/** Original2016 table331599e8,32000 uint16 entries; SHA256 3ce4be0c27f2772951ebb07473af27b343bcd98958dbc86f8d2d0a2444cf966c.
 * Static source, never a measured battle seed. */
import {sourceOriginalRandomWord2016} from './source-random-table-v53.mjs';
export function addOriginalRandomQ(seed,index=0){
 if(!Number.isInteger(seed)||!Number.isInteger(index))throw new TypeError("Original Add seed and index must be integers");
 const n=((seed+index)%32000+32000)%32000,value=sourceOriginalRandomWord2016(n);
 return Math.trunc(value/32000*100);
}
