import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {stat} from 'node:fs/promises';
import {Transform} from 'node:stream';

export const staticResourceRevision=file=>[file.dev,file.ino,file.size,file.mtimeMs,file.ctimeMs].join(':');
const hashFile=async filename=>{const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');};
export class StaticResourceChangedError extends Error {constructor(){super('static-resource-revision-changed');}}

/** Do not finish an HTTP representation until its actual decoded bytes match
 * the validator. Hold the last block, and abort an oversized replacement before
 * sending enough bytes to satisfy the original Content-Length. A gzip pipeline
 * also cannot emit its final footer when this source validation fails.
 */
export function createVerifiedResourceStream(expectedDigest,expectedSize,{verifyDigest=true}={}){
  const hash=verifyDigest?createHash('sha256'):null;let pending=null,bytes=0;
  return new Transform({
    transform(chunk,encoding,callback){
      bytes+=chunk.length;
      if(bytes>expectedSize)return callback(new StaticResourceChangedError());
      hash?.update(chunk);
      if(pending)this.push(pending);
      pending=chunk;callback();
    },
    flush(callback){
      if(bytes!==expectedSize||hash&&hash.digest('hex')!==expectedDigest)return callback(new StaticResourceChangedError());
      if(pending)this.push(pending);
      callback();
    },
  });
}

/** Server-local memoization only; authorization still runs before every use.
 * A new file revision discards both its validator and compressed representation.
 * Browser validators describe decoded bytes; gzip uses the corresponding weak
 * validator because its transfer representation may differ across zlib builds.
 */
export class StaticResourceCache {
  constructor({byteLimit=32*1024*1024,entryLimit=16*1024*1024,sourceLimit=64*1024*1024,metadataLimit=2048}={}){
    this.limits={byteLimit,entryLimit,sourceLimit,metadataLimit};this.records=new Map();this.bytes=0;
    this.stats={hashReads:0,gzipBuilds:0,gzipHits:0};
  }
  remove(filename){const old=this.records.get(filename);if(old?.gzip)this.bytes-=old.gzip.length;this.records.delete(filename);}
  async verify(entry){
    let file;
    try {file=await stat(entry.filename);}
    catch(error){if(this.records.get(entry.filename)===entry)this.remove(entry.filename);entry.digest=null;throw error;}
    if(staticResourceRevision(file)!==entry.signature){
      if(this.records.get(entry.filename)===entry)this.remove(entry.filename);
      throw new StaticResourceChangedError();
    }
  }
  record(filename,file){
    let entry=this.records.get(filename);const signature=staticResourceRevision(file);
    if(entry?.signature!==signature){this.remove(filename);entry={filename,signature,size:file.size};this.records.set(filename,entry);}
    else {this.records.delete(filename);this.records.set(filename,entry);}
    while(this.records.size>this.limits.metadataLimit)this.remove(this.records.keys().next().value);
    return entry;
  }
  async etag(entry,compressed){
    await this.verify(entry);
    if(!entry.digest){this.stats.hashReads++;entry.digest=(async()=>{const digest=await hashFile(entry.filename);await this.verify(entry);return digest;})().catch(error=>{entry.digest=null;throw error;});}
    const digest=entry.digest;
    return (compressed?'W/':'')+'"sha256-'+await digest+(compressed?'-gzip':'')+'"';
  }
  async compressed(entry){
    await this.verify(entry);
    if(entry.gzip){this.stats.gzipHits++;return entry.gzip;}
    if(entry.uncacheable||entry.size>this.limits.sourceLimit)return null;
    if(entry.pending)return entry.pending;
    this.stats.gzipBuilds++;
    entry.pending=(async()=>{
      const source=createReadStream(entry.filename),gzip=createGzip(),chunks=[];let size=0;
      const forward=error=>gzip.destroy(error);source.on('error',forward);source.pipe(gzip);
      try {
        for await(const chunk of gzip){size+=chunk.length;if(size>this.limits.entryLimit||size>this.limits.byteLimit){entry.uncacheable=true;return null;}chunks.push(chunk);}
        const body=Buffer.concat(chunks,size);
        await this.verify(entry);
        // Invalidation/eviction during an in-flight build must never repopulate
        // its obsolete entry or charge bytes that are no longer in the LRU.
        if(this.records.get(entry.filename)===entry){
          while(this.bytes+size>this.limits.byteLimit){const victim=[...this.records.values()].find(other=>other!==entry&&other.gzip);if(!victim)break;this.bytes-=victim.gzip.length;delete victim.gzip;}
          entry.gzip=body;this.bytes+=size;
        }
        return body;
      } finally {source.unpipe(gzip);source.destroy();gzip.destroy();source.removeListener('error',forward);}
    })().finally(()=>{delete entry.pending;});
    return entry.pending;
  }
}

export function matchesResourceTag(header,etag){
  const weak=value=>value.trim().replace(/^W\//,'');
  return typeof header==='string'&&header.split(',').some(value=>value.trim()==='*'||weak(value)===weak(etag));
}
