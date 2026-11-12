/** Derive filter reasons from immutable recorded observations, without simulation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const path=resolve(root,'reports/rf-down-hit-observations-v16.json');
const handover=JSON.parse(readFileSync(path));
const privatePath=resolve(root,handover.privateObservation.path);
if(!privatePath.startsWith(resolve(root,'artifacts')+'/')&&!privatePath.startsWith(resolve(root,'artifacts')+'\\'))
  throw new TypeError('Private observations must remain inside this task artifacts');
const bytes=readFileSync(privatePath);
if(bytes.length!==handover.privateObservation.bytes||createHash('sha256').update(bytes).digest('hex')!==handover.privateObservation.sha256)
  throw new TypeError('Recorded private Down-hit observations drifted');
const full=JSON.parse(bytes);
const landing=full.cases.flatMap(c=>c.samples.filter(s=>c.landingTimes.includes(s.time)&&s.active&&s.overlap));
const analysis={method:'Filter immutable recorded samples at their landed-event times; use original repeatEligible/invincible/hp flags, no new simulation.',
  landingActiveOverlapSamples:landing.length,
  landingPriorHitSamples:landing.filter(s=>s.priorHit).length,
  landingInvincibleSamples:landing.filter(s=>s.invincible).length,
  landingEligibleOverlapSamples:landing.filter(s=>!s.invincible&&s.hp>0&&s.repeatEligible).length,
  landingEligibleAcceptedSamples:landing.filter(s=>!s.invincible&&s.hp>0&&s.repeatEligible&&s.accepted).length,
  inputNoAttackGroups:{},closeGapGroups:{}};
for(const c of full.cases){
  const key=`gap${c.fixture.gap}/${c.fixture.mode}/dash${c.fixture.dash}`;
  if([0,20,-20].includes(c.fixture.gap)){
    analysis.closeGapGroups[key]??={};
    analysis.closeGapGroups[key][c.classification]=(analysis.closeGapGroups[key][c.classification]??0)+1;
  }
  if(c.classification==='input-no-jump-z'){
    const reason=c.dropRejected.length?'CanDown-rejected':c.stateChanges.some(s=>s.state==='RSI_JUMP_DOWN')?'JumpDown-then-land-before-Z':
      c.stateChanges.some(s=>s.state==='RSI_DASH_JUMP')?'DashJump-succeeded-before-other-input':'no-air-state';
    analysis.inputNoAttackGroups[reason]=(analysis.inputNoAttackGroups[reason]??0)+1;
  }
}
if(process.argv.includes('--check')){
  if(JSON.stringify(handover.additionalReadOnlyAnalysis)!==JSON.stringify(analysis))throw new TypeError('Recorded derived analysis drifted');
}else{
  handover.additionalReadOnlyAnalysis=analysis;writeFileSync(path,JSON.stringify(handover,null,2)+'\n');
}
console.log(JSON.stringify({check:process.argv.includes('--check'),landingPriorHitSamples:analysis.landingPriorHitSamples,
  landingEligibleOverlapSamples:analysis.landingEligibleOverlapSamples,landingEligibleAcceptedSamples:analysis.landingEligibleAcceptedSamples,
  inputNoAttackGroups:analysis.inputNoAttackGroups}));
