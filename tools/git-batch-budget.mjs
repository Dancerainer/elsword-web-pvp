/** Budget the exact SHA-1 `git cat-file --batch` framing before reading blobs. */
export const MAX_BASELINE_BATCH_BYTES=256*1024*1024;
export function baselineBatchBudget(metadata,count){
  if(!Number.isSafeInteger(count)||count<1||count>20000)throw Error('Bounded nonempty baseline source inventory required');
  const rows=metadata.split('\n');if(rows.at(-1)==='')rows.pop();
  if(rows.length!==count)throw Error('Baseline Git size inventory count differs');
  let bytes=0;
  for(const row of rows){
    const match=/^blob (0|[1-9]\d*)$/.exec(row);
    if(!match)throw Error('Baseline Git size inventory requires existing blobs');
    const size=Number(match[1]);
    // <40-char object id> SP blob SP <decimal size> LF <body> LF.
    bytes+=48+match[1].length+size;
    if(!Number.isSafeInteger(size)||!Number.isSafeInteger(bytes)||bytes>MAX_BASELINE_BATCH_BYTES)
      throw Error('Baseline Git blob inventory exceeds the 256 MiB batch limit');
  }
  // Small headroom accommodates pipe chunks while the aggregate stays bounded.
  return {bytes,maxBuffer:Math.min(MAX_BASELINE_BATCH_BYTES,bytes+64*1024)};
}
