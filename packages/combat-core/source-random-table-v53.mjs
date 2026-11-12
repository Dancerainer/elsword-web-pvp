/** One shared original2016 u16 table for Add and ordinary Miss consumers.
 * The captured permutation is data, not evidence of a runtime seed producer. */
import source from '../../contracts/source-random-table-2016.json' with {type:'json'};
let words;
export function sourceOriginalRandomWord2016(index){
 if(!Number.isInteger(index)||index<0||index>=32000)throw TypeError('Normalized original random table index required');
 if(!words){
  const binary=atob(source.data);if(binary.length!==64000)throw TypeError('Corrupt captured 2016 random table');
  words=Uint16Array.from({length:32000},(_,i)=>binary.charCodeAt(i*2)|(binary.charCodeAt(i*2+1)<<8));
 }
 return words[index];
}
