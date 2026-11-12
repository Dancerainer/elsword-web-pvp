/** Share identical immutable binary encodes across recipients. This cache owns
 * neither delivery ordering nor transport lifetime. Hashes only select a bucket;
 * every hit still compares all bytes, so a collision cannot change a packet. */
export function createBinaryCompressionCache({compress,maximumEntries=64,maximumBytes=2*1024*1024}={}){
  if(typeof compress!=='function'||!Number.isSafeInteger(maximumEntries)||maximumEntries<1
    ||!Number.isSafeInteger(maximumBytes)||maximumBytes<2)throw Error('invalid-binary-compression-cache');
  const entries=new Map();let reservedBytes=0;
  const metrics={compressions:0,shared:0,evictions:0,failures:0};
  const keyOf=bytes=>{let hash=2166136261;for(const value of bytes)hash=Math.imul(hash^value,16777619)>>>0;return `${bytes.length}:${hash}`;};
  const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  function remove(row){if(!entries.delete(row))return;reservedBytes-=row.reserved;}
  return {
    encode(bytes){
      if(!(bytes instanceof Uint8Array)||bytes.length*2>maximumBytes)throw Error('binary-compression-cache-size');
      const key=keyOf(bytes);
      for(const row of entries.keys())if(row.key===key&&equal(row.input,bytes)){metrics.shared++;return row.promise;}
      // Reserve both the immutable input and the worst-case retained result.
      // packOnlineBinary only returns a result no larger than the input.
      const reserved=bytes.length*2;
      while(entries.size>=maximumEntries||reservedBytes+reserved>maximumBytes){remove(entries.keys().next().value);metrics.evictions++;}
      const row={key,input:bytes.slice(),reserved,settled:false,promise:null};
      metrics.compressions++;entries.set(row,true);reservedBytes+=reserved;
      row.promise=Promise.resolve().then(()=>compress(row.input)).then(result=>{
        if(!(result instanceof Uint8Array)||result.length>row.input.length)throw Error('binary-compression-cache-result');
        row.settled=true;return result;
      }).catch(error=>{metrics.failures++;remove(row);throw error;});
      return row.promise;
    },
    discardPending(promise){for(const row of entries.keys())if(!row.settled&&row.promise===promise)remove(row);},
    clear(){entries.clear();reservedBytes=0;},
    performance(){return {...metrics,entries:entries.size,reservedBytes,maximumEntries,maximumBytes};},
  };
}
