"""Bound inherited awakening initialization, future/event callbacks and body collision."""
from pathlib import Path
import hashlib,json,struct,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
sha=lambda b:hashlib.sha256(b).hexdigest()
raw=SOURCE.read_bytes();assert sha(raw)==EXPECTED
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(id,a,end,meaning,code=True):
 b=raw[offset(a):offset(a)+end-a]
 r={'id':id,'address':hex(a),'bytes':len(b),'fileOffset':offset(a),'sha256':sha(b),'hex':b.hex(),'meaning':meaning}
 if code:
  ins=list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a));assert sum(i.size for i in ins)==len(b),id
  r['instructions']=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in ins]
 return r
spec=[
 ('future-thunk',0x32725770,0x32725775,'Registered future-start thunk targets shared HyperModeStartFuture31f2efa0'),
 ('start-thunk',0x327790c0,0x327790c5,'Registered start thunk targets Add FormationModeStart32768bf0'),
 ('event-thunk',0x32725760,0x32725765,'Registered event thunk targets31f33880'),
 ('end-thunk',0x32725780,0x32725785,'Registered end thunk targets31f2efc0'),
 ('future-wrapper',0x31f2efa0,0x31f2efb6,'Calls actual vtable610 then reserves hyper count zero flag; not an explicit attack producer'),
 ('add-future-common-vtable',0x330625bc+0x610,0x330625bc+0x614,'Actual Add vtable610 points3272edb0',False),
 ('add-start-common-vtable',0x330625bc+0x614,0x330625bc+0x618,'Actual Add vtable614 points32753a00',False),
 ('add-future-frame-vtable',0x330625bc+0x618,0x330625bc+0x61c,'Actual Add vtable618 points32764770; complete override and its class callbacks are inspected below',False),
 ('add-event-common-vtable',0x330625bc+0x624,0x330625bc+0x628,'Actual Add vtable624 points32764840; complete override and base event are inspected below',False),
 ('add-future-common-entry',0x3272edb0,0x3272eff2,'Complete Add CommonStateStartFuture: User31f91460, POSSIBLE_NASOD_BARRIER bool and class allowlist; no direct attack request'),
 ('formation-start-common-call',0x32768c2b,0x32768c37,'FormationModeStart calls actual vtable614 before class-specific formation work'),
 ('add-common-start',0x32753a00,0x32753a86,'Complete small override: first calls UserCommonStateStart31f96ef0; later guarded factory animation and effect cleanup are separate from normal attack window initialization'),
 ('damage-reset-and-table',0x31f9b619,0x31f9b65d,'User state start SimpleInit(actor20c), binds attacker this, then loads optional DAMAGE_DATA_ULTIMATE/DAMAGE_DATA'),
 ('attack-window-clear-and-table',0x31f9bb8f,0x31f9bbd2,'User state start actor62bc vector resize0; reserve count then ATTACK_TIME BeginTable; false skips to31f9bc7a'),
 ('attack-window-resize-zero',0x31fc0230,0x31fc0296,'Vector resize branch shrinks to requested count, including zero; actor state does not retain last attack-time entries'),
 ('common-frame-attack-helper',0x31fa8598,0x31fa859f,'UserCommonFrameMove calls31f535d0 which contains the ordinary unit attack window consumer'),
 ('attack-empty-gate',0x31f536fd,0x31f5372a,'Count actor62bc..62c0 entries; empty count jumps31f53a74 past the DamageCheck call'),
 ('attack-time-gate',0x31f5374b,0x31f537a5,'For each entry, strict current animation >start and <end gates active flag'),
 ('attack-active-gate',0x31f537f0,0x31f537f8,'Inactive attack time skips to next entry31f53a43'),
 ('ordinary-unit-damage-check',0x31f5389c,0x31f538b7,'Only within the active window, pass actor20c data to DamageCheck324f7e40'),
 ('set-damage-table-wrapper',0x31f343d0,0x31f34405,'User SetDamageData passes name, Lua manager and actor20c to324f94e0'),
 ('optional-damage-table-gate',0x324f951b,0x324f954d,'Table open failure jumps3250459b before parsing body'),
 ('optional-damage-table-false',0x3250459b,0x325045c7,'Missing table returns false with RET10h; no table-body damage parse'),
 ('hyper-event',0x31f33880,0x31f338c8,'Animation end changes to ground WAIT13 or air JUMP_DOWN17, then actual common-event virtual624'),
 ('hyper-end',0x31f2efc0,0x31f2efd9,'Calls actual common-end virtual62c and clears last hyper count actor699c'),
 ('add-common-future-frame',0x32764770,0x3276483d,'Complete override: landed air-action permission reset, DP/Mutation packing3273c150, LP target timers3275eca0, DE SpaceCrack cleanup327538a0; tail calls User31f9fc70'),
 ('add-ability-sync-data',0x3273c150,0x3273c1b7,'Complete getter packs clamped mutation count0..6 shifted13 with current DP; no attack request'),
 ('lp-target-timer',0x3275eca0,0x3275ed6a,'Complete target-row expiry and used-flag update; calls320ab960(false) to update skill-slot UI'),
 ('skill-slot-ui',0x320ab960,0x320aba1b,'Complete UpdateSkillSlotUI entry: own-unit guard and per-class UI refresh dispatch; no DamageCheck call in entry'),
 ('de-space-crack-cleanup',0x327538a0,0x32753925,'Complete flag cleanup: keep active for state213/214 or skill29212, otherwise clear actor7352; no attack/effect creation'),
 ('add-common-event',0x32764840,0x32764919,'Complete override: formation and DP<=0 disables formation and writes future action28; tail calls User31f66400'),
 ('add-get-formation',0x3273c020,0x3273c034,'Complete gauge104 getter, false when gauge absent'),
 ('add-set-formation',0x3273c040,0x3273c072,'Complete gauge104 setter; false only writes the flag; true also copies cooldown actor6fd8 to gauge114'),
 ('user-common-event',0x31f66400,0x31f66751,'Complete common event: pending revive/action, secret-chain state, skill-input callback, AB switch, jump platform, detonation charge, death/fall; conditional state requests distinguished from attacks'),
 ('add-special-attack-event',0x32755860,0x32755922,'Complete input skill dispatcher: actual648 CanUseSpecialAttack gate and nonnull skill pointer required before actual64c StateChangeSpecialAttack'),
 ('add-special-input-gate',0x3276b95b,0x3276b9bc,'Skill lock timer and unit pointer gates;31f31840 must return true and supply nonnull skill slot'),
 ('user-skill-key-selection',0x31f31840,0x31f31acc,'Complete common skill-key selector: only oneA/S/D/C/Q/W/E/R byte gates write slot pointer/index; returning true without a key leaves output null'),
 ('user-detonation-event',0x31f6c7a0,0x31f6c807,'Complete own MP-charge gate: riding exclusion, NO_DETONATION clears charge, no allowlist plus Z/X enables charge; no attack request'),
 ('future-body-defaults',0x31f914bf,0x31f915c7,'Sets future land-connect=true, encrypted canPush=true and canPass=false; not damage initialization'),
 ('future-can-push-lua',0x31f928d7,0x31f92a8a,'Decoded CAN_PUSH_UNIT, bool fallback true, writes encrypted future actor5cfc'),
 ('future-can-pass-lua',0x31f92a8a,0x31f92c4b,'Decoded CAN_PASS_UNIT, bool fallback false, writes encrypted future actor5d08 and saved actor626c'),
 ('future-timed-push-consumer',0x31f9fe9e,0x31f9ffbb,'When future skin exists, consume due8-byte push rows, update future canPush flag, erase consumed row; no damage request'),
 ('future-timed-pass-consumer',0x31f9ffbb,0x31fa00d8,'When future skin exists, consume due8-byte pass rows, update future canPass flag, erase consumed row; no damage request'),
 ('future-animation-common-hook',0x31f91ac1,0x31f91ad7,'Calls actual Add vtable4d8 with animation name/playtype outputs'),
 ('add-animation-hook-vtable',0x330625bc+0x4d8,0x330625bc+0x4dc,'Actual Add vtable4d8 target32aed3b0 is a no-op',False),
 ('add-animation-hook-noop',0x32aed3b0,0x32aed3b3,'RET8 no-op; this hook does not inject attack data'),
 ('future-animation-flag-vtable',0x330625bc+0x20c,0x330625bc+0x210,'Actual Add vtable20c target31fcba60 returns actor6ad8 animation flag',False),
 ('future-animation-flag-getter',0x31fcba60,0x31fcba67,'Getter reads actor byte6ad8; not a DamageData or collision-object pointer'),
 ('future-skin-frame-hook',0x31fa09c8,0x31fa0a0f,'No frameStop and no stopAdvanceTime gates future-skin vtable4 OnFrameMove'),
 ('skin-frame-vtable',0x32ff9344+4,0x32ff9344+8,'CKTDGXSkinAnim vtable4 targets31d0e520; full animation-resource event semantics not sealed in this bounded supplement',False),
 ('future-gauge-frame-hook',0x31fa0afe,0x31fa0b21,'Calls gauge vtable34 on actor97c'),
 ('add-gauge-frame-vtable',0x3302ffac+0x34,0x3302ffac+0x38,'CX2AddGageData vtable34 target3277bcf0',False),
 ('add-gauge-frame',0x3277bcf0,0x3277bd50,'Complete Add gauge callback: base gauge update3277aa40 plus own formation cooldown114 decrement/clamp0'),
 ('base-gauge-frame',0x3277aa40,0x3277ab0c,'Complete base gauge entry: charge callback38, own HP regeneration and own MP callback54; no direct DamageCheck'),
 ('future-physics-hook',0x31fa0f03,0x31fa0f1c,'Only when future frameStop=false calls actual Add virtual640 PhysicProcess31f6c810'),
 ('add-physics-vtable',0x330625bc+0x640,0x330625bc+0x644,'Actual Add virtual640 is User PhysicProcess31f6c810',False),
 ('body-can-pass-guard',0x31f6ed98,0x31f6edb9,'True future canPass bypasses the blocking body loop to31f6f159; this is a body-position permission'),
 ('body-can-push-check',0x31f6ef39,0x31f6ef86,'Own/other canPush flags choose CheckPassUnit31f34860 vs positional push processing'),
 ('body-push-call',0x31f6efd3,0x31f6f01f,'Calls ProcessCanPushUnit31f677e0; failure restores local position from future5e0c'),
 ('body-position-fallback',0x31f6f0f2,0x31f6f13d,'Failure restores local position from future5e0c and zeros own nowSpeed.x actor1ac'),
 ('body-check-pass-unit',0x31f34860,0x31f34aeb,'Complete geometric pass check: current/proposed/other position and height, distance and vector tests; returns bool, no attack data or DamageCheck'),
 ('body-push-position-write',0x31f67f71,0x31f67fc7,'ProcessCanPushUnit positional result writes x/y/z through passed position output'),
 ('physics-portal-tail',0x31f710e5,0x31f71116,'Calls own jumping/bungee helpers then optional delegate actor6d54/6d58; qualified reference names latter game-type portal movement callback'),
]
blocks=[block(*s) for s in spec]
for index,value in [(5,0x3272edb0),(6,0x32753a00),(7,0x32764770),(8,0x32764840)]:assert int.from_bytes(bytes.fromhex(blocks[index]['hex']),'little')==value
by_id={b['id']:b for b in blocks}
for key,value in [('add-animation-hook-vtable',0x32aed3b0),('future-animation-flag-vtable',0x31fcba60),('skin-frame-vtable',0x31d0e520),('add-gauge-frame-vtable',0x3277bcf0),('add-physics-vtable',0x31f6c810)]:
 assert int.from_bytes(bytes.fromhex(by_id[key]['hex']),'little')==value
prior=ROOT/'contracts/add-awakening-native-v45.json';prior_bytes=prior.read_bytes();prior_data=json.loads(prior_bytes)
state=prior_data['originalDeclarations']['addState']['raw'];assert not any(k.startswith('ATTACK_TIME') or k.startswith('DAMAGE_DATA') for k in state)
assert not any(k.startswith('STOP_') or k.startswith('STOP2_') for k in state)
literal_keys=[]
for name,a,end,encoded,mask,field,default in [
 ('CAN_PUSH_UNIT',0x31f928d7,0x31f92a8a,'3019595c280e4cb0f0e305b51f','73581703785b1ff8afb64bfc4b','0x5cfc',True),
 ('CAN_PASS_UNIT',0x31f92a8a,0x31f92c4b,'40391540a8eee518a31e6dc87f','03785b1ff8afb64bfc4b23812b','0x5d08',False),
]:
 e,m=bytes.fromhex(encoded),bytes.fromhex(mask);assert bytes(x^y for x,y in zip(e,m)).decode('ascii')==name
 native=raw[offset(a):offset(a)+end-a]
 assert all(e[i:i+4] in native for i in [0,4,8]) and bytes([0xb0,e[12]]) in native
 xor_values={int(i.op_str.rsplit(', ',1)[1],0) for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(native,a) if i.mnemonic=='xor' and i.op_str.rsplit(', ',1)[-1].startswith(('0x','1','2','3','4','5','6','7','8','9'))}
 assert set(m)<=xor_values
 literal_keys.append({'decoded':name,'encodedHex':encoded,'xorMaskHex':mask,'address':hex(a),'bytes':end-a,'sha256':sha(native),'nativeFieldOffset':field,'parserFallback':default,'qualification':'Encoded constructor bytes and every XOR mask checked in sealed original block; bytewise XOR reconstructs the key. Lua global FALSE in the raw state remains a separately unresolved symbol.'})
inspected=[]
for name,a,end,scope in [
 ('User.CommonStateStartFuture',0x31f91460,0x31f96ee1,'Full decode/call inventory; collision defaults/Lua overrides and actual animation hook are sealed separately. Not an exhaustive proof over every callee.'),
 ('User.CommonFrameMoveFuture',0x31f9fc70,0x31fa1217,'Full decode/call inventory; timed body flags, animation/gauge/physics boundaries inspected. No direct324f7e40, but indirect/data-driven callbacks remain separate.'),
 ('User.PhysicProcess',0x31f6c810,0x31f7113a,'Full decode/call inventory; body push/pass loop and position fallback inspected. No direct324f7e40; map/portal callbacks are not reclassified as damage producers.'),
 ('User.ProcessCanPushUnit',0x31f677e0,0x31f680f2,'Full decode/call inventory and position output inspected. Geometry/model getters remain indirect; no direct324f7e40.'),
 ('User.CommonFrameMoveFuture_TimedEvent',0x31f45f10,0x31f4640c,'Full decode/call inventory; STOP_ALL/STOP2_ALL/STOP_MY/STOP2_MY consumers depend on loaded lists. Add wake declaration has none; distance proof remains in source-distance-native-v45.'),
]:
 b=raw[offset(a):offset(a)+end-a];ins=list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a));assert sum(i.size for i in ins)==len(b)
 calls=[{'address':hex(i.address),'target':i.op_str} for i in ins if i.mnemonic=='call']
 assert not any(i['target']=='0x324f7e40' for i in calls)
 inspected.append({'name':name,'address':hex(a),'bytes':len(b),'sha256':sha(b),'instructionCount':len(ins),'callCount':len(calls),'calls':calls,'scope':scope,'qualification':'Static decoded byte-range hash and call inventory, not a whole-callgraph negative proof; required narrow machine spans retain hex/instructions in blocks.'})
refs=[]
for path,lines,meaning in [
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[14430,14545],'Qualified2026 DamageData SimpleInit/table load and clearing/refilling attack-time vector'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[18144,18198],'Qualified2026 ordinary unit attack-time loop and DamageCheck'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[26157,26218],'Qualified2026 Hyper start/future/event/end names'),
 ('runtime/add-feedback-v45/Add.cpp',[2856,2863],'Qualified2026 reconstructed Add registration names FormationModeStart and inherited callbacks'),
 ('runtime/add-feedback-v45/Add.cpp',[4832,4885],'Qualified2026 FormationModeStart semantic aid, includes later reconstructed edits; not original2016 source'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[13528,13920],'Qualified2026 future initialization names, animation hooks and body push/pass declarations; raw2016 keys and writes independently sealed'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[14813,15393],'Qualified2026 future movement, gauge and timed STOP callback names'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[19415,19517],'Qualified2026 own detonation, skill input, platform jump and death state semantic reference; original event contains additional pending revive handling'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[20231,20357],'Qualified2026 body push/pass position resolution; later NPC additions are not inherited into original2016'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[20738,20764],'Qualified2026 optional game-type portal delegate name; original call at31f71114 independently sealed'),
 ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp',[21116,21246],'Qualified2026 skill-key selector names; original31f31840 independently requires key bytes to select a slot'),
 ('runtime/add-feedback-v45/Add.cpp',[2185,2278],'Qualified2026 Add future-start and future-frame semantic aids; later edits retain explicit qualification'),
 ('runtime/add-feedback-v45/Add.cpp',[2410,2422],'Qualified2026 formation DP-exhaustion event name'),
 ('runtime/add-feedback-v45/Add.cpp',[13454,13486],'Qualified2026 LP target row expiry and skill-slot UI reference'),
 ('.cache/native-source-runtime/X2Lib/X2Game.cpp',[10244,10300],'Qualified2026 UpdateSkillSlotUI name and per-class UI calls'),
 ('.cache/player-feedback-v45/source/X2GageData.cpp',[1177,1189],'Qualified2026 Add gauge base call and own formation cooldown update'),
]:
 b=(ROOT/path).read_bytes();refs.append({'path':path,'sha256':sha(b),'lines':lines,'meaning':meaning,'qualification':'Frozen/reconstructed2026 reference only; original machine evidence above is independent.'})
result={'schemaVersion':1,'id':'add-awakening-collision-native-v45','targetExecuted':False,'targetClientMeasured':False,
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729','qualification':'Existing late snapshot can be non-atomic; derived and original client identities remain distinct.'},
 'blocks':blocks,'previousContract':{'path':str(prior.relative_to(ROOT)).replace('\\','/'),'sha256':sha(prior_bytes),'originalStateHasAttackWindow':False,'originalStateHasDamageData':False},
 'qualifiedReferences':refs,'decodedCollisionKeys':literal_keys,'inspectedRanges':inspected,
 'boundedConclusion':'The ordinary inherited attack-window residue route is excluded. Complete Add future-frame/event overrides and their small class callbacks resolve to permission reset, gauge synchronization, LP target UI, DE SpaceCrack flag cleanup and DP-exhaustion exit. The base event skill request is gated by skill-key selection and a nonnull skill slot. Future body flags govern push/pass position resolution and do not supply an awakening DamageData. No universal awakening hard-stagger producer has been established; this is not a whole-class/global animation-event absence proof.',
 'unresolvedProducerStatus':'No source-bound universal awakening hard-stagger producer found; do not implement unknown damage/radius/reaction.',
 'resolvedEntryScopes':[
  {'entry':'0x32764770','status':'Complete override and class callbacks inspected','branches':[{'target':'0x3273c150','kind':'ordinary-own-gauge-sync'},{'target':'0x3275eca0','kind':'LP-existing-target-timer-and-UI','next':'0x320ab960'},{'target':'0x327538a0','kind':'DE-existing-SpaceCrack-flag-cleanup'},{'target':'0x31f9fc70','kind':'base-future-frame','coverage':'inspectedRanges and sealed flags/hooks'}]},
  {'entry':'0x32764840','status':'Complete override plus complete base event inspected','branches':[{'condition':'formation && DP<=0','kind':'own-state-request-action28','targets':['0x3273c020','0x3273c040']},{'target':'0x31f66400','kind':'base-event','conditionalStateRequests':['pending-revive/action','secret-chain32996c10','skill-key-gated32755860/3276b920/31f31840','jump-platform','death/fall']}]},
  {'entry':'0x31f91460','status':'Full decode/inventory; requested body collision and animation hook branches inspected','collisionFields':['LAND_CONNECT actor5cf8','CAN_PUSH_UNIT actor5cfc','CAN_PASS_UNIT actor5d08','saved canPass actor626c'],'downstream':['timed push/pass vectors6804/6814','PhysicProcess31f6c810','CheckPassUnit31f34860','ProcessCanPushUnit31f677e0'],'nonDamageHooks':[{'slot':'0x4d8','target':'0x32aed3b0','kind':'RET8 no-op'},{'slot':'0x20c','target':'0x31fcba60','kind':'animation flag getter6ad8'}]}],
 'boundedRemainingCandidates':[
  {'entry':'0x31d0e520','scope':'Future skin callback from31fa0a0d via CKTDGXSkinAnim vtable4; animation/resource events independent of ordinary ATTACK_TIME route','status':'Exact virtual target mapped. Full animation event/data dispatch is outside this bounded collision supplement; no original wake-specific attack-event record/DamageData was identified. Do not infer a hit from animation advancement alone.'},
  {'entry':'actor+0x6d54/0x6d58 at0x31f71114','scope':'Optional physical portal delegate; reconstructed2026 User20760 identifies game-type portal movement','status':'Call site and passed map pointer sealed. Runtime delegate binding is not measured, so its target is not invented or treated as a universal awakening callback.'},
  {'entry':'awakening-specific attack data','scope':'Need an actual original producer and its collision shape, DamageData, timing, reaction and owner, or original dynamic trace','status':'Still missing. Reads above do not close arbitrary Lua indirection or unrelated global callbacks. Missing values remain unsupported.'}],
 'limits':['No original client execution, original collision trace, hard-stagger timing or attacker-ownership observation.','Complete small methods, selected collision spans and complete-range call inventories have different coverage; a direct-call inventory does not close indirect or data-driven effects.','Raw state FALSE/TRUE are symbolic declarations, not silently resolved numeric globals; parser fallbacks and literal key identities are proven independently.','Frozen2026 sources are readable semantic references only; later NPC/custom-motion/source edits are not original2016 behavior.','SetDamageData false-return is not itself a proof that every other callback is inactive.','No unverified numerical attack fallback or production change is included.']}
out=ROOT/'contracts/add-awakening-collision-native-v45.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'path':str(out),'blocks':len(blocks),'sha256':sha(out.read_bytes()),'producer':result['unresolvedProducerStatus']}))
