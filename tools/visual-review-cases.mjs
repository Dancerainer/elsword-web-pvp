/** Explicit browser QA branches; production skill availability supplies IDs. */
export const VC_REVIEW_OVERHEAT_IDS=new Set([24034,24020,24021,24031,24022,24023,24024]);
export const IS_REVIEW_AIR_IDS=new Set([21024]);

export function visualReviewCases(profession,skills,{focused=false}={}){
  if(profession==='IS'){
    const selected=focused?skills.filter(s=>[21033,21021,21022,21024,21605].includes(s.skillId)):skills;
    return selected.flatMap(s=>[1,-1].flatMap(facing=>['normal','awakened'].map(mode=>({
      skillId:s.skillId,mode,inputMode:IS_REVIEW_AIR_IDS.has(s.skillId)?'air':'default',facing}))));
  }
  if(profession!=='VC')throw new TypeError('Unsupported visual review profession');
  if(focused)return [24020,24031].flatMap(skillId=>[1,-1].flatMap(facing=>['normal','overheat'].map(mode=>({skillId,mode,inputMode:'default',facing}))));
  return skills.flatMap(s=>(s.skillId===24217?['default','follow-z','follow-x','return']:[24218,24221].includes(s.skillId)?['default','air']:['default']).flatMap(inputMode=>
    (VC_REVIEW_OVERHEAT_IDS.has(s.skillId)?['normal','overheat','awakened','awakened-overheat']:['normal','awakened']).map(mode=>({skillId:s.skillId,mode,inputMode}))));
}
