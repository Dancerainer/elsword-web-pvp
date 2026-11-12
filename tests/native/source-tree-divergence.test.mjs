/** Independent audit guard for reference-tree divergence.
 *
 * The pinned reference tree is a 2015-era code line that also carries 2026
 * revision markers. A marker inside a function this project compiles means the
 * delivered reference contains a dated marker. Its semantic relation to the
 * 2016 target is still unverified; the marker must nevertheless be
 * recorded in contracts/rf-source-tree-divergence-v11.json so no reader can
 * mistake the module for canonical 2016 code.
 *
 * This test recomputes the record from bytes and also fails when a dated line
 * appears inside a compiled fragment without being recorded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const json=p=>JSON.parse(read(p));
const sha=b=>createHash('sha256').update(b).digest('hex');

const annotation=json('contracts/rf-source-tree-divergence-v11.json');
const manifest=json('artifacts/native/manifest.json');
// Only the current revision campaign matters here. The reference tree also
// carries historical dated comments (for example 2011-07-05 inside
// GetCriticalPercent) that are part of the original code line, not later edits.
const dated=/2026-\d\d-\d\d/;

function sourceLines(path){
  return read('.cache/native-source-runtime/'+path).toString('latin1').split(/(?<=\n)/);
}

test('every recorded divergence matches the compiled module and the source bytes',()=>{
  assert.equal(annotation.schemaVersion,1);
  assert.ok(Array.isArray(annotation.divergences)&&annotation.divergences.length>0);
  for(const row of annotation.divergences){
    const record=manifest.modules[row.module];
    assert.ok(record,`unknown compiled module ${row.module}`);
    assert.equal(record.sha256,row.moduleSha256,`${row.module} delivered bytes changed`);
    assert.equal(record.evidenceClass,row.moduleEvidenceClass,`${row.module} evidence class changed`);
    const fragment=(record.originalFunctions??[]).find(f=>f.path===row.path&&f.lineStart===row.lineStart&&f.lineEnd===row.lineEnd);
    assert.ok(fragment,`recorded fragment is not part of the compiled ${row.module} module`);
    const lines=sourceLines(row.path).slice(row.lineStart-1,row.lineEnd);
    const sourceBytes=Buffer.from(lines.join(''),'latin1');
    let bytes=sourceBytes;
    if(row.sourceRange){
      // extract() starts at the exact function signature. An original leading
      // /*virtual*/ annotation belongs to the source line, not that fragment.
      assert.equal(row.sourceRange.omittedPrefix,'/*virtual*/ ');
      assert.equal(row.sourceRange.omittedSuffix,'\r\n');
      assert.equal(sourceBytes.length,row.sourceRange.bytes,`${row.path} raw source range changed`);
      assert.equal(sha(sourceBytes),row.sourceRange.sha256,`${row.path} raw source range hash changed`);
      const prefix=Buffer.from(row.sourceRange.omittedPrefix,'latin1');
      const suffix=Buffer.from(row.sourceRange.omittedSuffix,'latin1');
      assert.deepEqual(sourceBytes.subarray(0,prefix.length),prefix,`${row.path} signature prefix changed`);
      assert.deepEqual(sourceBytes.subarray(-suffix.length),suffix,`${row.path} range suffix changed`);
      bytes=sourceBytes.subarray(prefix.length,sourceBytes.length-suffix.length);
    }
    assert.equal(bytes.length,row.bytes,`${row.path}:${row.lineStart}-${row.lineEnd} byte length changed`);
    assert.equal(sha(bytes),row.sha256,`${row.path}:${row.lineStart}-${row.lineEnd} bytes changed`);
    assert.equal(fragment.sha256,row.sha256,`module fragment record disagrees with the annotation`);
    for(const marker of row.sourceTreeMarkers){
      const line=lines[marker.line-row.lineStart];
      assert.ok(line!=null,`marker line ${marker.line} is outside the fragment`);
      assert.equal(line.replace(/\n$/,''),marker.text,`marker text at ${row.path}:${marker.line} changed`);
      assert.equal(sha(Buffer.from(line,'latin1')),marker.lineSha256,`marker bytes at ${row.path}:${marker.line} changed`);
      assert.ok(dated.test(marker.text),`recorded marker is not a dated edit`);
    }
    for(const stub of row.hostStubDependencies){
      const stubLine=read(stub.file).toString('utf8').split('\n')[stub.line-1];
      assert.ok(stubLine!=null,`stub location ${stub.file}:${stub.line} is gone`);
      assert.ok(stubLine.includes(stub.symbol.split('::').pop()),`stub ${stub.symbol} is no longer declared at ${stub.file}:${stub.line}`);
      if(stub.stub==='return false;')assert.ok(stubLine.includes(stub.stub),`stub ${stub.symbol} no longer returns false`);
      if(stub.sourceText)assert.equal(stubLine.trim(),stub.sourceText,`stub ${stub.symbol} initializer changed`);
    }
  }
});

test('no dated source edit inside a compiled fragment is left unrecorded',()=>{
  const recorded=new Set(annotation.divergences.map(r=>`${r.module}|${r.path}|${r.lineStart}|${r.lineEnd}`));
  const unrecorded=[];
  for(const [name,record] of Object.entries(manifest.modules)){
    const cache=new Map();
    for(const fragment of record.originalFunctions??[]){
      if(typeof fragment.lineStart!=='number')continue; // macros and extracted bodies are recorded by hash only
      if(!cache.has(fragment.path))cache.set(fragment.path,sourceLines(fragment.path));
      const lines=cache.get(fragment.path).slice(fragment.lineStart-1,fragment.lineEnd);
      for(const [index,line] of lines.entries()){
        if(!dated.test(line))continue;
        if(recorded.has(`${name}|${fragment.path}|${fragment.lineStart}|${fragment.lineEnd}`))continue;
        unrecorded.push(`${name} ${fragment.path}:${fragment.lineStart+index} ${line.trim().slice(0,90)}`);
      }
    }
  }
  assert.deepEqual(unrecorded,[],'compiled modules contain 2026-dated source edits that contracts/rf-source-tree-divergence-v11.json does not record');
});

test('the reference tree is never described as target client source',()=>{
  assert.equal(manifest.referenceCommit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  assert.equal(manifest.fullTargetClientExecuted,false);
  for(const [name,record] of Object.entries(manifest.modules)){
    assert.match(record.evidenceClass,/reference|reconstruction/i,`${name} lacks a reference/reconstruction evidence class`);
    assert.doesNotMatch(record.evidenceClass,/target-client-source|target2016-source|official-2016/i,`${name} claims target client source`);
  }
});
