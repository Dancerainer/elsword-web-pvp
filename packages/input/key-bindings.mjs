/** Shared browser/server action configuration. This is a web control contract;
 * original UI evidence lives in contracts/rf-key-bindings-source-v1.json. */
export const KEY_BINDING_ACTIONS = Object.freeze(['up','down','left','right','z','x','awaken','skill1','skill2','skill3','skill4','skill5','skill6','skill7','skill8','special']);
export const KEY_BINDING_LABELS = Object.freeze({up:'Up / Jump',down:'Down / Drop',left:'Left',right:'Right',z:'Attack Z',x:'Attack X',awaken:'Awakening',skill1:'Skill 1',skill2:'Skill 2',skill3:'Skill 3',skill4:'Skill 4',skill5:'Skill 5',skill6:'Skill 6',skill7:'Skill 7',skill8:'Skill 8',special:'Special action V'});
export const DEFAULT_KEY_BINDINGS = Object.freeze({schemaVersion:1,bindings:Object.freeze({up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',z:'KeyZ',x:'KeyX',awaken:'ControlLeft',skill1:'KeyQ',skill2:'KeyW',skill3:'KeyE',skill4:'KeyR',skill5:'KeyA',skill6:'KeyS',skill7:'KeyD',skill8:'KeyC',special:'KeyV'})});
const actions = Object.freeze({up:'UP',down:'DOWN',left:'LEFT',right:'RIGHT',z:'Z',x:'X',awaken:'AWAKEN',skill1:'Q',skill2:'W',skill3:'E',skill4:'R',skill5:'A',skill6:'S',skill7:'D',skill8:'C',special:'SPECIAL'});
const allowed = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Control(Left|Right)|Shift(Left|Right)|Space|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;
const canonical = code => code.replace(/^Shift(Left|Right)$/,'Shift');
export function keyCodeLabel(code){
  const names={ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',ControlLeft:'Left Ctrl',ControlRight:'Right Ctrl',ShiftLeft:'Left Shift',ShiftRight:'Right Shift',Space:'Space',Minus:'−',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/'};
  return names[code]??(/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):code?.replace(/^Numpad/,'Numpad ')??'Unassigned');
}
export function validateKeyBindings(value){
  const errors=[];
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||!value.bindings||typeof value.bindings!=='object'||Array.isArray(value.bindings))return {valid:false,errors:[{action:null,code:'schema',message:'Key bindings require schemaVersion 1 and a complete bindings object'}]};
  for(const key of Object.keys(value))if(!['schemaVersion','bindings'].includes(key))errors.push({action:null,code:'unknown-field',message:'Unknown key binding field: '+key});
  const used=new Map();
  for(const action of KEY_BINDING_ACTIONS){
    const code=Object.hasOwn(value.bindings,action)?value.bindings[action]:null;
    if(typeof code!=='string'||!allowed.test(code)){errors.push({action,code:'reserved-or-unknown',message:KEY_BINDING_LABELS[action]+': choose a letter, number, arrow key, Ctrl, Shift, Space or punctuation key. Esc, Tab, function keys and system keys are reserved.'});continue;}
    const identity=canonical(code);
    if(used.has(identity))errors.push({action,code:'conflict',otherAction:used.get(identity),message:KEY_BINDING_LABELS[action]+' and '+KEY_BINDING_LABELS[used.get(identity)]+' both use '+keyCodeLabel(code)});
    else used.set(identity,action);
  }
  for(const key of Object.keys(value.bindings))if(!KEY_BINDING_ACTIONS.includes(key))errors.push({action:key,code:'unknown-action',message:'Unknown action: '+key});
  return {valid:errors.length===0,errors};
}
export function normalizeKeyBindings(value=DEFAULT_KEY_BINDINGS){
  const result=validateKeyBindings(value);if(!result.valid)throw new TypeError(result.errors.map(e=>e.message).join('；'));
  return {schemaVersion:1,bindings:Object.fromEntries(KEY_BINDING_ACTIONS.map(a=>[a,value.bindings[a]]))};
}
export function compileKeyBindings(config=DEFAULT_KEY_BINDINGS){
  const normalized=normalizeKeyBindings(config),codes=new Map(KEY_BINDING_ACTIONS.map(a=>[normalized.bindings[a],actions[a]]));
  return code=>codes.get(code)??null;
}
export function translateKeyboardCode(code,config=DEFAULT_KEY_BINDINGS){return compileKeyBindings(config)(code);}
export function coreKeyLabel(coreKey,config=DEFAULT_KEY_BINDINGS){const action=KEY_BINDING_ACTIONS.find(a=>actions[a]===coreKey);return action?keyCodeLabel(config.bindings[action]):coreKey;}
/** Bind releases to the action selected on keydown. Applying new settings must
 * clear the sampled device, then call releaseAll; it never fabricates a press. */
export function createKeyBindingTranslator(config=DEFAULT_KEY_BINDINGS){
  let translate=compileKeyBindings(config);const physical=new Map();
  return {
    down(code){if(physical.has(code))return null;const action=translate(code);if(action)physical.set(code,action);return action;},
    up(code){const action=physical.get(code)??null;physical.delete(code);return action;},
    releaseAll(){const released=[...physical.values()];physical.clear();return released;},
    setBindings(value){const next=compileKeyBindings(value),released=this.releaseAll();translate=next;return released;},
    translate(code){return translate(code);},
  };
}
