import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {baselineBatchBudget,MAX_BASELINE_BATCH_BYTES} from '../../tools/git-batch-budget.mjs';

test('baseline budget includes all Git headers and body delimiters within a fixed ceiling',()=>{
  assert.equal(baselineBatchBudget('blob 0\nblob 9\nblob 10\n',3).bytes,167);
  assert.ok(baselineBatchBudget('blob 67174400\n',1).maxBuffer>64*1024*1024);
  assert.ok(baselineBatchBudget('blob 268435397\n',1).maxBuffer<=MAX_BASELINE_BATCH_BYTES);
  for(const [metadata,count] of [['blob 1\n',2],['missing\n',1],['tree 1\n',1],['blob -1\n',1],['blob 9007199254740992\n',1],['blob 268435456\n',1]])
    assert.throws(()=>baselineBatchBudget(metadata,count),/inventory|limit/);
  assert.throws(()=>baselineBatchBudget('',0),/Bounded/);
  assert.throws(()=>baselineBatchBudget('blob 1\n',20001),/Bounded/);
});

test('real Git batch preserves twelve complete source blobs beyond 64 MiB',async t=>{
  const runtime=path.resolve(import.meta.dirname,'../../runtime');await mkdir(runtime,{recursive:true});
  const fixture=await mkdtemp(path.join(runtime,'git-batch-budget-'));
  t.after(async()=>{assert.ok(path.resolve(fixture).startsWith(runtime+path.sep));await rm(fixture,{recursive:true,force:true});});
  const git=(args,options={})=>execFileSync('git',args,{cwd:fixture,...options});
  git(['init','--quiet']);
  // One content-addressed fixture object keeps disk use small. Requesting it
  // for twelve source entries still exercises the real 72 MiB stdout boundary.
  const body=Buffer.alloc(6*1024*1024,0x61);body[0]=0x7b;body[body.length-1]=0x7d;
  const hash=git(['hash-object','-w','--stdin'],{input:body,encoding:'utf8'}).trim();
  const input=(hash+'\n').repeat(12);
  const metadata=git(['cat-file','--batch-check=%(objecttype) %(objectsize)'],{input,encoding:'utf8'});
  const budget=baselineBatchBudget(metadata,12);
  const output=git(['cat-file','--batch'],{input,maxBuffer:budget.maxBuffer});
  assert.equal(output.length,budget.bytes);assert.ok(output.length>64*1024*1024);
  const header=Buffer.from(hash+' blob '+body.length+'\n');
  const expected=createHash('sha256').update(body).digest('hex');
  let cursor=0;
  for(let i=0;i<12;i++){
    assert.deepEqual(output.subarray(cursor,cursor+header.length),header);cursor+=header.length;
    assert.equal(createHash('sha256').update(output.subarray(cursor,cursor+body.length)).digest('hex'),expected);cursor+=body.length;
    assert.equal(output[cursor++],10);
  }
  assert.equal(cursor,output.length,'every compatibility entry has its entire original body');
});
