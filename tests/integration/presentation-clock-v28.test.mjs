import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const game=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const source=game.slice(game.indexOf('function resetDisplayClock('),game.indexOf('\n',game.indexOf('function resetDisplayClock(')));
test('display clock rebase preserves presentation and an actual scene reset clears retained managers',()=>{
  const calls=[],context={inputStageTrace:{reset(){calls.push('input-trace');}},buffAfterimages:{clear(){calls.push('afterimages');}},addSummonView:{clear(){calls.push('summons');}},impactCamera:{clear(){calls.push('camera');}},hitFramebuffer:{clear(){calls.push('framebuffer');}},groundShadows:{clear(){calls.push('shadows');}},inputStepClock:{rebase(){calls.push('clock');}},performance:{now:()=>1000},simulation:null};
  vm.createContext(context);vm.runInContext(source,context);
  context.resetDisplayClock();assert.deepEqual(calls,['input-trace','afterimages','clock']);
  calls.length=0;context.resetDisplayClock({resetPresentation:true});assert.deepEqual(calls,['input-trace','afterimages','summons','shadows','clock']);
});
test('manual tick retains pending hit presentation while practice reset explicitly cancels it',()=>{
  const manual=game.slice(game.indexOf('if(manual){resetDisplayClock();'),game.indexOf('if(manual){resetDisplayClock();')+100);
  assert.ok(manual.startsWith('if(manual){resetDisplayClock();'));
  assert.ok(game.includes('simulation.restore(baselineSnapshot);resetDisplayClock({resetPresentation:true});'));
  for(const reason of ['practice-map-change','profession-change'])assert.ok(game.includes(`beginRecording('${reason}');resetDisplayClock({resetPresentation:true});`));
});
