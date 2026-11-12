/** Bounded reliable upload prefix. A partial frontier admits canonical events
 * and protection only; its actor/effect pose must never be committed. This is
 * a Web transport capacity adapter, not a recovered native wire format. */
const encoder=new TextEncoder();
export const MAXIMUM_OWNER_UPLOAD_BYTES=96*1024;

export function buildOwnerUploadPrefix(latest,{actions=latest.actions??[],hits=latest.hits??[],
  maximumBytes=MAXIMUM_OWNER_UPLOAD_BYTES,maximumActions=16}={}){
  const history=[...actions].sort((a,b)=>a.id-b.id).slice(0,maximumActions);
  const value={...latest,hits:[...hits],actions:history};
  if(actions.length>history.length)value.actionFrontierComplete=false;
  // Retain the oldest whole actions until exact receipt, without dropping a
  // hit, action field or effect from an action's dependency closure.
  while(encoder.encode(JSON.stringify(value)).length>maximumBytes){
    if(history.length>1){history.pop();value.actionFrontierComplete=false;continue;}
    if(history.length===1&&value.effects.length){
      // A large action and its replaceable pose can each fit alone but exceed
      // the cap together (for example Apocalypse's simultaneous effects).
      // The existing false frontier prevents effects:[] from erasing anything.
      value.effects=[];value.actionFrontierComplete=false;continue;
    }
    throw Error('owner-action-message-too-large');
  }
  return value;
}
