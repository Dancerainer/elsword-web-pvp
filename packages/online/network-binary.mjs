/** Web envelope v3. Compact field identifiers follow the native 2016 idea of
 * typed records; this is deliberately NOT an original 2016 wire packet.
 * The dictionary is part of this version, never learned from another packet.
 * Numeric values are lossless: float32 is used only when exactly representable.
 */
export const NETWORK_BINARY_VERSION=3;
export const NETWORK_BINARY_LEGACY_VERSION=1;
// Web tuning, not an inferred original-client constant. Native-source A/B
// found a 1 KiB cutoff inflated common Buff/pose updates; 512 preserves small
// packet bypass without losing their compression benefit.
export const NETWORK_BINARY_COMPRESSION_THRESHOLD=512;
const MAGIC=Object.freeze([0x45,0x57,0x4e,0x42]); // EWNB; byte 4 selects the immutable format.
const DEFAULT_MAXIMUM_BYTES=1024*1024,DEFAULT_DECODED_BYTES=4*1024*1024;
const MAX_DEPTH=48,MAX_ENTRIES=65536,MAX_NODES=262144;
const FORBIDDEN=new Set(['__proto__','prototype','constructor']);
// Append/change/reorder only with a new wire version. The exported frozen table
// makes dictionary identity auditable without a connection-dependent cache.
export const NETWORK_BINARY_DICTIONARY=Object.freeze((
 'v full epoch frameSeq base report meta actor buffs effects s d n b p protocol actions hits '
+'type playerId roomId data sequence seq ack acknowledgedEpoch acknowledgedFrameSeq '
+'actionSeq actionId actionFrontier actionFrontierComplete actionFrontierSeq actionFrameSeq '
+'x y z vx vy vz facing state stateTime stateSerial grounded lineId lastTouchLineId '
+'animationTime animationName animationLoop animationBeforeTime animationOneshotTimer '
+'animationPlaybackSpeed animationTransitionSerial animationStopped animationSpeedRamp '
+'presentationTransition applyMotionOffset consumeRootTranslation rootMotionEnabled motionMoveNow '
+'passiveSpeed canNotJumpTime jumpAttackDown sourceCommandFlags canNotAttackTime reAttackZ1Time '
+'reAttackZ1Right sourceDashJumpEffectHandle landPosition hp mp awakening core cooldowns '
+'skillId skillContext hitStop worldStop effectiveBlackHoleIds blackHoleDisplacement '
+'sourceBlackHoleCanPass fired hitGaps buffered tapTimes doubleHeldDirections ignoreLineId '
+'dropRemaining death invincible showInvincible superArmor superArmorNotRed limitCrusherCharging '
+'skillScale soundSet pendingPlatformJump pendingPressed tapReleased downForce jumpOnLanding '
+'knockdown manaBreak flyCount lastAttackerFront deathPresentation deathAlpha hidden deathComplete '
+'downSuccessor buffControls sourceArcEnemy sourceMegaDrill sourceMegaDrillNowSupported '
+'sourceWildCharge sourceXCrash sourceWildChargeEffectGroup sourceAwakeningAuraEffectGroup '
+'sourceCustomStateEffectGroup sourceDashJumpEffectGroup sourceCommandDirection sourceCommandHandPosition '
+'skillDisableGravity skillDownAccel skillSuperArmorNotRed animationSpeedOverride animationTargetSpeed '
+'platformAttackInput additionalDamageEffect sourceStatusClock forceInvincible wayOfSword '
+'destructionRageRemaining sourceWayOfSwordEffectGroup sourceLordKnight sourceRuneSlayer '
+'sourceRuneSlayerHitReceipts sourceReflectionNotice sourceVeteranCommander sourceInfinitySword '
+'sourceBladeMaster sourceElesisSkills sourceElesisCommand sourceElesisBreakCharge sourceElesisGaleHits '
+'sourceElesisComboRemaining sourceElesisEndurance sourceElesisBurst sourceAdd sourceAddMovement '
+'sourceAddCombat sourceAddSummon sourceTimeRing sourceTimeSickness sourceTimeRingNotice '
+'sourceAddTargetNotice sourceAddDroneMark sourceAddStigma sourceAddStigmaNotice sourceAddFantasyTracer '
+'downAttackChoice standupAttackNoDown mapMechanics sourceShadowStep id name templateId remaining '
+'elapsed duration startFrame endFrame sourceFrame sourceTime source sourceId target targetId '
+'ownerId parentId definition damage templateFields initialSize initialVelocity initialDirSpeed '
+'initialAnimationName initialAnimationPlayback velocityEvidence traitPolicy sourceSetTargetMesh '
+'fields removed nested actorBirth effectBirths buffBirths effectUpdates actorUpdate buffUpdates '
+'playback targetViews samples from to frame time tick clock count index value active enabled '
+'position velocity direction scale rotation alpha mesh particle motion hit result amount '
+'flags tag force revision version complete controls status pose kind reason code error '
+'event events delta snapshot players owners updates receipt receipts timestamp sentAt '
+'receivedAt sourceAgeMs transport reliable ready life team inputs seed mode winner '
+'local-owner-v1 owner-pose owner-action owner-status owner-ack ping pong peer-hello '
+'owner-report owner-state owner-receipt owner-control effect birth update end '
+'effectId actionType serverFrame clientFrame combatFrame actionAck actionAckSeq '
+'receivedFrameSeq receivedEpoch statusRevision statusFrameSeq sourceCounter normalized '
+'peerId connectionId transportVersion binaryVersion baseline baselines baselinesRequired '
+'retainedActions retainedEffects playerEpoch participantId matchId matchEpoch '
+'acknowledgedActionSeq acknowledgedStatusRevision sourceActionSeq baseFrameSeq '
+'ownerPose ownerPoseDelta ownerActions ownerActionDelta ownerStatus ownerUpload '
+'frameDelta actorDelta effectDelta statusClock stopFrames stopUntilFrame sourceStop '
+'actorSource effectsSource maxHp maxMp raw typeId slot level stack stacks '
+'attackId attackSerial victimId attackerId hurt hitType hitSerial damageId '
+'birthFrame birthTime endTime sourceEpoch pendingEnded targetEpoch '
+'dx dy dz fx fy fz min max speed timer progress sampleFrame stateFrame '
+'owner-pose-delta owner-action-delta owner-status-delta owner-upload-delta'
).split(' '));
// Version 1 keeps its original IDs. Version 2 adds actual Web Buff terms,
// rather than pretending the earlier generic stack/timer words covered them.
export const NETWORK_BINARY_DICTIONARY_V2=Object.freeze([...NETWORK_BINARY_DICTIONARY,...(
 'schemaVersion skillLevel accumulationLimit resistance durationMultiplier behaviors finalizers displayer sourceActorId targetActorId factorId accumulationCount '
+'sourceDuration stateSerial criterion passUp changeType stat interval sum identityCleared attackTypes multiplier chance sourceBehavior templateIds element sourceSkillId skillType '
+'empty dashBlock manaBreakBlock stun stat hpInterval mpInterval onHitBuffFactor absorbMagicProjectile finishOtherBuffs elementAttackRate normalHpDrain normalHitBuff skillCooldown phantomSword ignoreDefence elesisDoubleAttack elesisUnsupported elesisImmediateKnockdown attackByType addDpGain immediate received '
+'mpMax physicalAttack magicAttack criticalRate criticalAttack finalDefenceMultiplier finalDamageMultiplierMelee finalDamageMultiplierRange physicalDefence magicDefence moveSpeedMultiplier jumpSpeedMultiplier animationSpeedMultiplier accuracy enchantAttackRate everyAttributeDefence hitMeleeMpMultiplier hitRangeMpMultiplier receivedMpMultiplier additionalAttackPercent forceDownMultiplierMelee forceDownMultiplierRange'
).split(' ').filter((value,index,values)=>!NETWORK_BINARY_DICTIONARY.includes(value)&&values.indexOf(value)===index)]);
// V3 retains both earlier tables unchanged. These names come from the current
// motion/status/action producers and their shared actor/effect subrecords.
// Values/unknown keys never disappear: a zero key code carries a full string.
export const NETWORK_BINARY_DICTIONARY_V3=Object.freeze([...NETWORK_BINARY_DICTIONARY_V2,...(
 'packet held pressed released motionVersion motionMaxVersion motionOnly owner-motion-v1 reaction locomotion movementHeld '
+'statusOnly buffSyncVersion buffStatus buffRevision owner-buff-status-v1 owner-status-v1 requesterId buff-sync controlSequence ownerDelta poseDelta codec m '
+'serial fromName fromLoop fromSpeed fromWeight retainedPose fromApplyMotionOffset fromTime elapsedSeconds durationSeconds '
+'gauge orbs pendingOrbs pendingAvailableOrbs phase phaseTime attackLevel guardRemaining parrying canParry helperLive swapRemaining white '
+'sourceHitCountByte sourceFacingHistory previous current lastDamageSeconds now pending addedThisState activated charge maxCharge minimumCharge availableMax pendingCost canCharge noDetonation damageReactPending inputBlock '
+'portalLineId portalElapsed portalReady bungeeLineId bungeeElapsed returnSerial portalSerial portalNotice lastReturn lockRemaining '
+'start ownerStateSerial setName parentEffectId hyperMode setStartAnimation setStartState stage hitCount childCounts soundFired setElapsed deleteConditions deleteOnStateEnd powerMultiplier '
+'sourceSkillMeshControl sourceMeshLandY mainEffectName sourceLiteralMeshClock sourceXCrashMeshClock lifeTimeSeconds meshLifetimeElapsed birthAnchor currentAnchor definitionMember '
+'BDT_EFFECT_SET LEFT RIGHT UP DOWN RSI_WAIT ESSI_SWORD_WAIT RSI_WALK RSI_DASH RSI_DASH_END '
+'RSI_DAMAGE_SMALL_FRONT RSI_DAMAGE_SMALL_BACK RSI_DAMAGE_BIG_FRONT RSI_DAMAGE_BIG_BACK RSI_DAMAGE_AIR_SMALL RSI_DAMAGE_AIR_UP RSI_DAMAGE_AIR_FALL RSI_DAMAGE_AIR_DOWN '
+'RSI_DAMAGE_AIR_DOWN_INVINCIBLE RSI_DAMAGE_AIR_FLY_FRONT RSI_DAMAGE_AIR_FLY_BACK RSI_DAMAGE_DOWN_FRONT RSI_DAMAGE_DOWN_BACK RSI_DAMAGE_AIR_DOWN_LANDING RSI_DAMAGE_STANDUP_FRONT RSI_DAMAGE_STANDUP_BACK'
).split(' ').filter((value,index,values)=>!NETWORK_BINARY_DICTIONARY_V2.includes(value)&&values.indexOf(value)===index)]);
// The typed record stores fields in their original enumeration order. A zero
// key code is an explicit extension, so future counters and identities remain
// lossless without mutating a frozen schema or dropping unknown fields.
export const NETWORK_BINARY_BUFF_FIELDS=Object.freeze([
 Object.freeze('schemaVersion templateId skillLevel accumulationLimit resistance durationMultiplier behaviors finalizers displayer sourceActorId targetActorId factorId accumulationCount'.split(' ')),
 Object.freeze('type kind value changeType stat interval sum identityCleared attackTypes multiplier chance sourceBehavior reason factorId skillId mp templateIds element sourceSkillId skillType evidenceClass'.split(' ')),
 Object.freeze('kind remaining sourceDuration stateSerial criterion passUp'.split(' '))
]);
const BUFF_SCHEMAS=NETWORK_BINARY_BUFF_FIELDS.map(fields=>({fields,index:new Map(fields.map((key,index)=>[key,index+1])),sizes:fields.map(quotedBytes)}));
const T={NULL:0,FALSE:1,TRUE:2,UINT:3,NEGINT:4,F32:5,F64:6,UTF8:7,UTF16:8,OBJECT:9,WORD:10,ARRAY:11,UNDEFINED:12,HOLE:13,NULL_OBJECT:14,RECORD:15,NULL_RECORD:16,KEY_OBJECT:17,NULL_KEY_OBJECT:18,STRING_REF:19};
// V3 tags 32..159 encode exact integers 0..127; 160..191 encode -1..-32.
// The packet-local string table is reset on every encode/decode, so loss,
// reordering or reconnection cannot make a later envelope undecodable.
const SMALL_UINT=32,SMALL_NEGINT=160,MAX_PACKET_STRINGS=1024,MIN_PACKET_STRING_LENGTH=4;
const DICTIONARIES=new Map([[1,NETWORK_BINARY_DICTIONARY],[2,NETWORK_BINARY_DICTIONARY_V2],[3,NETWORK_BINARY_DICTIONARY_V3]].map(([version,words])=>{
 const entries=words.map((word,index)=>{let rest=index;const token=[T.WORD];do{const digit=rest%128;rest=Math.floor(rest/128);token.push(digit+(rest?128:0));}while(rest);if(token.length>3)throw Error('network-binary-dictionary-size');return {word,token:Uint8Array.from(token),keyCode:index+1,size:quotedBytes(word)};});
 const index=new Map(entries.map(entry=>[entry.word,entry]));if(index.size!==words.length)throw Error('network-binary-dictionary-duplicate');return [version,{entries,index}];
}));
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const own=Object.prototype.hasOwnProperty;
const plain=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function limit(value,fallback){const out=value??fallback;if(!Number.isSafeInteger(out)||out<1||out>256*1024*1024)throw Error('network-binary-limit');return out;}
function inputBytes(value){
 if(value instanceof Uint8Array)return value;
 if(value instanceof ArrayBuffer)return new Uint8Array(value);
 if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 throw Error('network-binary-input');
}
export function isNetworkBinary(value){
 let bytes;try{bytes=inputBytes(value);}catch{return false;}
 return bytes.length>MAGIC.length&&MAGIC.every((byte,index)=>bytes[index]===byte)&&DICTIONARIES.has(bytes[MAGIC.length]);
}
// Exact UTF-8 size of a JSON quoted string, including well-formed JSON escape
// rules for lone UTF-16 surrogates. No whole-tree JSON string is allocated.
function quotedBytes(value){
 let size=2;
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);
  if(c===34||c===92||c===8||c===9||c===10||c===12||c===13)size+=2;
  else if(c<32)size+=6;
  else if(c<128)size++;
  else if(c<2048)size+=2;
  else if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){size+=4;i++;}else size+=6;}
  else size+=c>=0xdc00&&c<=0xdfff?6:3;
 }
 return size;
}
/** JSON-compatible decoded size for the existing network accounting/limits.
 * Like JSON.stringify: undefined object members disappear; array holes and
 * undefined become null; non-finite numbers become null. The codec itself
 * preserves those distinctions. A top-level undefined has no JSON encoding. */
export function networkJsonByteLength(value,{maximumBytes=DEFAULT_DECODED_BYTES}={}){
 const maximum=limit(maximumBytes,DEFAULT_DECODED_BYTES),path=new Set();let size=0,nodes=0;
 const add=n=>{size+=n;if(size>maximum)throw Error('network-binary-decoded-size');};
 function visit(item,depth){
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)throw Error('network-binary-depth-or-nodes');
  if(item===null){add(4);return;}
  if(typeof item==='boolean'){add(item?4:5);return;}
  if(typeof item==='number'){add(Number.isFinite(item)?String(item).length:4);return;}
  if(typeof item==='string'){add(quotedBytes(item));return;}
  if(typeof item==='undefined'){add(4);return;}
  if(typeof item!=='object'||path.has(item))throw Error('network-binary-value');
  path.add(item);
  if(Array.isArray(item)){
   if(item.length>MAX_ENTRIES)throw Error('network-binary-entries');add(2+Math.max(0,item.length-1));
   for(let i=0;i<item.length;i++)visit(item[i],depth+1);
  }else{
   if(!plain(item))throw Error('network-binary-object');const keys=Object.keys(item);if(keys.length>MAX_ENTRIES)throw Error('network-binary-entries');
   add(2);let count=0;
   for(const key of keys){if(item[key]===undefined)continue;add(quotedBytes(key)+1+(count++?1:0));visit(item[key],depth+1);}
  }
  path.delete(item);
 }
 if(value===undefined)throw Error('network-binary-no-json-value');visit(value,0);return size;
}
export function encodeNetworkBinary(value,{maximumBytes=DEFAULT_MAXIMUM_BYTES,version=NETWORK_BINARY_VERSION}={}){
 const dictionary=DICTIONARIES.get(version);if(!dictionary)throw Error('network-binary-version');
 const maximum=limit(maximumBytes,DEFAULT_MAXIMUM_BYTES);let bytes=new Uint8Array(Math.min(maximum,1024)),view=new DataView(bytes.buffer),offset=0,nodes=0;
 const path=new Set(),strings=version>=3?new Map():null;
 function reserve(n){if(n>maximum-offset)throw Error('network-binary-size');if(offset+n<=bytes.length)return;const next=new Uint8Array(Math.min(maximum,Math.max(offset+n,bytes.length*2)));next.set(bytes);bytes=next;view=new DataView(bytes.buffer);}
 function byte(n){reserve(1);bytes[offset++]=n;}
 function uint(n){do{const part=n%128;n=Math.floor(n/128);byte(part+(n?128:0));}while(n);}
 function string(value){
  const entry=dictionary.index.get(value);if(entry!==undefined){
   const token=entry.token;reserve(token.length);bytes.set(token,offset);offset+=token.length;return;
  }
  if(strings&&value.length>=MIN_PACKET_STRING_LENGTH){
   const reference=strings.get(value);if(reference!==undefined){byte(T.STRING_REF);uint(reference);return;}
   if(strings.size<MAX_PACKET_STRINGS)strings.set(value,strings.size);
  }
  let wellFormed=true;
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff)){wellFormed=false;break;}}else if(c>=0xdc00&&c<=0xdfff){wellFormed=false;break;}}
  // Check the minimum before UTF-8 allocation; a hostile local caller cannot
  // force an unbounded temporary even when the output limit is tiny.
  if(value.length>maximum-offset)throw Error('network-binary-size');
  if(!wellFormed){byte(T.UTF16);uint(value.length);reserve(value.length*2);for(let i=0;i<value.length;i++){view.setUint16(offset,value.charCodeAt(i),true);offset+=2;}return;}
  const encoded=encoder.encode(value);byte(T.UTF8);uint(encoded.length);reserve(encoded.length);bytes.set(encoded,offset);offset+=encoded.length;
 }
 function write(item,depth,context=0){
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)throw Error('network-binary-depth-or-nodes');
  if(item===null){byte(T.NULL);return;}
  if(item===undefined){byte(T.UNDEFINED);return;}
  if(typeof item==='boolean'){byte(item?T.TRUE:T.FALSE);return;}
  if(typeof item==='string'){string(item);return;}
  if(typeof item==='number'){
   if(version>=3&&Number.isInteger(item)&&!Object.is(item,-0)){
    if(item>=0&&item<128){byte(SMALL_UINT+item);return;}
    if(item<0&&item>=-32){byte(SMALL_NEGINT-item-1);return;}
   }
   if(Number.isSafeInteger(item)&&!Object.is(item,-0)){byte(item<0?T.NEGINT:T.UINT);uint(Math.abs(item));return;}
   if(Object.is(Math.fround(item),item)){byte(T.F32);reserve(4);view.setFloat32(offset,item,true);offset+=4;}
   else{byte(T.F64);reserve(8);view.setFloat64(offset,item,true);offset+=8;}return;
  }
  if(typeof item!=='object'||path.has(item))throw Error('network-binary-value');path.add(item);
  if(Array.isArray(item)){
   if(item.length>MAX_ENTRIES)throw Error('network-binary-entries');byte(T.ARRAY);uint(item.length);
   for(let i=0;i<item.length;i++){if(own.call(item,i))write(item[i],depth+1,context);else byte(T.HOLE);}
  }else{
   if(!plain(item))throw Error('network-binary-object');const keys=Object.keys(item);if(keys.length>MAX_ENTRIES)throw Error('network-binary-entries');
   if(version===1){
    byte(Object.getPrototypeOf(item)===null?T.NULL_OBJECT:T.OBJECT);uint(keys.length);
    for(const key of keys){if(FORBIDDEN.has(key))throw Error('network-binary-key');string(key);write(item[key],depth+1);}
    path.delete(item);return;
   }
   const buff=item.schemaVersion===1&&own.call(item,'templateId')&&Array.isArray(item.behaviors)&&Array.isArray(item.finalizers);
   const schemaId=buff?1:context===2&&own.call(item,'type')&&own.call(item,'kind')?2:context===3&&own.call(item,'kind')&&own.call(item,'remaining')?3:0;
   const schema=BUFF_SCHEMAS[schemaId-1],nullObject=Object.getPrototypeOf(item)===null;
   byte(schema?(nullObject?T.NULL_RECORD:T.RECORD):version>=3?(nullObject?T.NULL_KEY_OBJECT:T.KEY_OBJECT):(nullObject?T.NULL_OBJECT:T.OBJECT));if(schema)byte(schemaId);uint(keys.length);
   for(const key of keys){
    if(FORBIDDEN.has(key))throw Error('network-binary-key');
    if(schema){const code=schema.index.get(key)??0;byte(code);if(!code)string(key);}
    else if(version>=3){const code=dictionary.index.get(key)?.keyCode??0;uint(code);if(!code)string(key);}
    else string(key);
    write(item[key],depth+1,buff&&key==='behaviors'?2:buff&&key==='finalizers'?3:0);
   }
  }
  path.delete(item);
 }
 reserve(MAGIC.length+1);bytes.set(MAGIC);offset=MAGIC.length;byte(version);write(value,0);return bytes.slice(0,offset);
}
export function decodeNetworkBinary(value,{maximumBytes=DEFAULT_MAXIMUM_BYTES,maximumDecodedBytes=DEFAULT_DECODED_BYTES}={}){
 const bytes=inputBytes(value),maximum=limit(maximumBytes,DEFAULT_MAXIMUM_BYTES),decodedMaximum=limit(maximumDecodedBytes,DEFAULT_DECODED_BYTES);
 if(bytes.length>maximum)throw Error('network-binary-size');if(!isNetworkBinary(bytes))throw Error('network-binary-version');
 const version=bytes[MAGIC.length],dictionary=DICTIONARIES.get(version),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),strings=[],stringIndex=new Map();let offset=MAGIC.length+1,nodes=0,allocated=0;
 const spend=n=>{allocated+=n;if(allocated>decodedMaximum)throw Error('network-binary-decoded-size');};
 const require=n=>{if(n>bytes.length-offset)throw Error('network-binary-truncated');};
 function byte(){require(1);return bytes[offset++];}
 function uint(){let out=0,scale=1;for(let i=0;i<8;i++){const part=byte(),digit=part&127;out+=digit*scale;if(!Number.isSafeInteger(out))throw Error('network-binary-integer');if(!(part&128)){if(i&&digit===0)throw Error('network-binary-integer');return out;}scale*=128;}throw Error('network-binary-integer');}
 function string(tag){
  if(tag===T.WORD){const entry=dictionary.entries[uint()];if(!entry)throw Error('network-binary-dictionary');spend(entry.size);return entry.word;}
  if(version>=3&&tag===T.STRING_REF){const entry=strings[uint()];if(!entry)throw Error('network-binary-string-reference');spend(entry.size);return entry.value;}
  if(tag!==T.UTF8&&tag!==T.UTF16)throw Error('network-binary-string');const length=uint();require(length*(tag===T.UTF16?2:1));
  if(length>decodedMaximum-allocated)throw Error('network-binary-decoded-size');let result;
  if(tag===T.UTF8){result=decoder.decode(bytes.subarray(offset,offset+length));offset+=length;}
  else{const parts=[];for(let end=offset+length*2;offset<end;){const codes=[];for(let j=0;j<4096&&offset<end;j++,offset+=2)codes.push(view.getUint16(offset,true));parts.push(String.fromCharCode(...codes));}result=parts.join('');}
  const size=quotedBytes(result);spend(size);
  if(version>=3&&result.length>=MIN_PACKET_STRING_LENGTH&&strings.length<MAX_PACKET_STRINGS&&!stringIndex.has(result)){
   stringIndex.set(result,strings.length);strings.push({value:result,size});
  }
  return result;
 }
 function read(depth){
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)throw Error('network-binary-depth-or-nodes');const tag=byte();
  if(version>=3&&tag>=SMALL_UINT&&tag<SMALL_NEGINT+32){const result=tag<SMALL_NEGINT?tag-SMALL_UINT:-(tag-SMALL_NEGINT+1);spend(String(result).length);return result;}
  if(tag===T.NULL||tag===T.UNDEFINED){spend(4);return tag===T.NULL?null:undefined;}
  if(tag===T.FALSE||tag===T.TRUE){spend(tag===T.TRUE?4:5);return tag===T.TRUE;}
  if(tag===T.UINT||tag===T.NEGINT){const n=uint();if(tag===T.NEGINT&&n===0)throw Error('network-binary-integer');const result=tag===T.UINT?n:-n;spend(String(result).length);return result;}
  if(tag===T.F32||tag===T.F64){const size=tag===T.F32?4:8;require(size);const result=size===4?view.getFloat32(offset,true):view.getFloat64(offset,true);offset+=size;spend(Number.isFinite(result)?String(result).length:4);return result;}
  if(tag===T.UTF8||tag===T.UTF16||tag===T.WORD||version>=3&&tag===T.STRING_REF)return string(tag);
  if(tag===T.ARRAY){const count=uint();if(count>MAX_ENTRIES)throw Error('network-binary-entries');require(count);spend(2+Math.max(0,count-1));const result=new Array(count);for(let i=0;i<count;i++){if(bytes[offset]===T.HOLE){offset++;spend(4);}else result[i]=read(depth+1);}return result;}
  if(tag===T.OBJECT||tag===T.NULL_OBJECT||version>=2&&(tag===T.RECORD||tag===T.NULL_RECORD)||version>=3&&(tag===T.KEY_OBJECT||tag===T.NULL_KEY_OBJECT)){
   const record=tag===T.RECORD||tag===T.NULL_RECORD,schema=record?BUFF_SCHEMAS[byte()-1]:null;if(record&&!schema)throw Error('network-binary-record');
   const count=uint();if(count>MAX_ENTRIES)throw Error('network-binary-entries');require(count*2);spend(2+Math.max(0,count-1)+count);const result=tag===T.NULL_OBJECT||tag===T.NULL_RECORD||tag===T.NULL_KEY_OBJECT?Object.create(null):{};
   for(let i=0;i<count;i++){
    let key;
    if(schema){const code=byte();if(code>schema.fields.length)throw Error('network-binary-record-field');if(code){key=schema.fields[code-1];spend(schema.sizes[code-1]);}else{key=string(byte());if(schema.index.has(key))throw Error('network-binary-record-extension');}}
    else if(tag===T.KEY_OBJECT||tag===T.NULL_KEY_OBJECT){
     const code=uint();if(code){const entry=dictionary.entries[code-1];if(!entry)throw Error('network-binary-key-code');key=entry.word;spend(entry.size);}
     else{key=string(byte());if(dictionary.index.has(key))throw Error('network-binary-key-extension');}
    }else key=string(byte());
    if(FORBIDDEN.has(key)||own.call(result,key))throw Error('network-binary-key');result[key]=read(depth+1);
   }return result;
  }
  throw Error('network-binary-tag');
 }
 const result=read(0);if(offset!==bytes.length)throw Error('network-binary-trailing');return result;
}
