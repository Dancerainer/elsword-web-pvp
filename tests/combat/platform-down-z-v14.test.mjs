/** Source consumer / simulation stability regressions; no target-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {downZFixture,startDownZ,observeDownZ} from '../helpers/authored-command-fixture.mjs';
import {dashZxFrame} from '../helpers/authored-command-fixture.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/rf-hits-source-v14.json',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=s=>JSON.parse(JSON.stringify(s.snapshot()));

test('expanded fixed source metadata retains independent identities and measurement boundary',()=>{
  assert.equal(source.sourceFiles.length,5);
  assert.equal(source.targetClientMeasured,false);assert.equal(source.originalClientMeasurementCount,0);
});
for(const file of source.sourceFiles)test(`expanded source pin and exact bodies: ${file.path}`,{
  skip:!existsSync(new URL('../../'+file.path,import.meta.url))?'Historical source input unavailable: '+file.path:false,
},()=>{
    const raw=readFileSync(new URL('../../'+file.path,import.meta.url));
    assert.equal(sha(raw),file.sha256,file.path);assert.equal(raw.length,file.bytes);
    assert.equal(createHash('sha1').update(Buffer.from(`blob ${raw.length}\0`)).update(raw).digest('hex'),file.gitBlob);
    const lines=raw.toString('latin1').match(/[^\n]*\n|[^\n]+$/g);
    for(const span of file.spans){
      const excerpt=Buffer.from(lines.slice(span.firstLine-1,span.lastLine).join(''),'latin1');
      const stop=excerpt.lastIndexOf(125)+1;
      assert.equal(sha(excerpt.subarray(0,stop)),span.sha256,span.signature);
    }
});

test('profile retains the fresh complete target jump-Z declaration and strict activation threshold',async()=>{
  const f=await downZFixture();
  const target=source.targetRaven.states.find(s=>s.name==='RSI_JUMP_COMBO_Z');
  assert.deepEqual(f.s.profile.states[target.name].raw,target.raw);
  assert.deepEqual(target.raw.ATTACK_TIME0,{'1':.11,'2':100});
  assert.equal(target.raw.DAMAGE_DATA.DAMAGE.PHYSIC,1.78);
  assert.deepEqual(target.raw.DISABLE_ATTACK_BOX,{'1':'Lhand1'});
});

test('compiled JumpZ Future applies extra down gravity only without held Up; native Event supplies landing/.2 jump lock',async()=>{
  const f=await downZFixture(),{s,a,n}=f;
  s.enter(a,'RSI_JUMP_COMBO_Z','literal-source-phase-test');a.vy=-100;a.grounded=false;
  const out=n.commands.runFuture(a,{held:['DOWN'],pressed:[]},s.profile,1/60);
  const extra=Math.fround(Math.fround(s.profile.physics.G_ACCEL)*Math.fround(1/60));
  assert.equal(out.vy,Math.fround(-100-extra));assert.equal(out.flags&1,1);
  const both=n.commands.runFuture(a,{held:['UP','DOWN'],pressed:[]},s.profile,1/60);
  assert.equal(both.vy,-100);assert.equal(both.flags&1,0);
  a.grounded=true;a.sourceCommandFlags=1;a.animationTime=.01;
  const land=n.commands.runEvent(a,{},s.profile);
  assert.equal(land.state,'RSI_JUMP_LANDING');assert.equal(land.canNotJumpTime,Math.fround(.2));
});

for(const facing of [-1,1])for(const dash of [false,true])for(const delay of [0,6])
test(`real platform ${dash?'662Z':'2Z'} facing ${facing}, delay ${delay} preserves accepted collision during active window`,async()=>{
  const out=await observeDownZ({facing,gap:70,delay,dash,targetFloor:'lower'});
  assert.equal(out.missedActiveOverlap,false,'No accepted source-geometry overlap may be discarded while the authored window is open');
  assert.ok(out.samples.length);assert.ok(out.samples.some(x=>x.active));
  assert.ok(!out.finished.state.includes('COMBO'),'finite action retirement');
  assert.ok(out.samples.every(x=>x.position.every(Number.isFinite)&&Number.isFinite(x.after)));
  if(out.landingFrameActiveOverlap)assert.ok(out.hitCount>0,'Landing must not clear an attack before this tick’s original collision consumer');
});

for(const facing of [-1,1])for(const dash of [false,true])
test(`Down/Z full JSON restore with original helpers: facing ${facing}, dash ${dash}`,async()=>{
  const f=await downZFixture({facing,gap:70,delay:1,dash}),g=await downZFixture({facing,gap:70,delay:1,dash});
  startDownZ(f);for(let i=0;i<5;i++)dashZxFrame(f,{held:['DOWN']});g.s.restore(json(f.s));
  for(let i=0;i<120;i++){dashZxFrame(f,{held:['DOWN']});dashZxFrame(g,{held:['DOWN']});}
  assert.deepEqual(json(f.s),json(g.s));
});

test('malformed public fixture inputs cannot mutate source/map into a plausible collision test',async()=>{
  for(const input of [{gap:NaN},{gap:-1},{gap:171},{facing:0},{delay:.5},{delay:41},{dash:'yes'},{holdDown:1},{targetFloor:'invented'}])
    await assert.rejects(()=>downZFixture(input),/Invalid bounded platform fixture/);
});
