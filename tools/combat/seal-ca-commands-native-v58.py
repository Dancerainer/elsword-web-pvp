"""Seal CA callbacks and target declarations without executing client/Lua.

The existing static analysis snapshot is a distinct, possibly non-atomic derived artifact.
This is bounded static evidence, not an original-client combat recording.
"""
from pathlib import Path
import copy, hashlib, json, re, struct, sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,'asset_sources/analysis/offline-libs')
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable
from build_rf_fx import declaration

sha=lambda b:hashlib.sha256(b).hexdigest()
source=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
raw=source.read_bytes()
expected='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
assert sha(raw)==expected
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(a,n,purpose,data=False):
 b=raw[offset(a):offset(a)+n]
 rows=[] if data else [{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str}
       for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a)]
 assert data or sum(len(bytes.fromhex(r['bytes'])) for r in rows)==n,(hex(a),n)
 return {'address':hex(a),'bytes':n,'fileOffset':offset(a),'sha256':sha(b),'hex':b.hex(),
         'purpose':purpose,'instructions':rows}
def scalar(a,value):
 b=raw[offset(a):offset(a)+4];v=struct.unpack('<f',b)[0]
 assert abs(v-value)<1e-6
 return {'address':hex(a),'value':v,'hex':b.hex(),'sha256':sha(b)}

profile=json.loads((ROOT/'packages/combat-core/ca-profile.json').read_text('utf8'))
originals={};prior=None
for key in ['enum','elesis','effect','damage']:
 pin=profile['sources'][key];p=Path(pin['path']);assert sha(p.read_bytes())==pin['sha256']
 v=read_declarations(p,prior,capture_calls=True,capture_unresolved=True)
 originals[key]=json.loads(json.dumps(v))
 if key=='enum':prior=EnumTable(v['globals'])
names=['ESI_DASH_COMBO_SCA_ZZZ_START','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1',
       'ESI_DASH_COMBO_SCA_ZZZ_LOOP_2','ESI_DASH_COMBO_SCA_ZZZ_END',
       'ESI_DASH_JUMP_COMBO_SDK_XX','ESI_DASH_JUMP_COMBO_SDK_XXX']
states={n:{'raw':originals['elesis']['globals'][n],'sourcePc':originals['elesis']['locations'][n]} for n in names}
for n,row in states.items():assert row['raw']==profile['states'][n]['raw'],n
set_names=['EffectSet_C_SCA_Dash_ZZZ','EffectSet_C_SCA_Dash_ZZZ_Uppercut','EffectSet_C_SCA_Dash_ZZZ_Finish']
sets={c['args'][-1]['NAME']:{'raw':c['args'][-1], 'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']}}
      for c in originals['effect']['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME') in set_names}
assert sorted(sets)==sorted(set_names)
dds={row['raw']['EFFECT0']['NAME'] for row in sets.values()}
damage={n:{'raw':originals['damage']['globals'][n],'sourcePc':originals['damage']['locations'][n]} for n in sorted(dds)}

normal=json.loads((ROOT/'contracts/ca-fx-index.json').read_text('utf8'))['templates']['SCA_Combo_ZZZ_Projectile_AttackBoX']
fxpath=Path('asset_work')/normal['source']['rawPath']
fxbytes=fxpath.read_bytes();assert sha(fxbytes)==normal['source']['sha256']
text=fxbytes.decode('latin1');name='SCA_Combo_ZZZ_Projectile_Finish_AttackBoX'
matches=list(re.finditer(r'TEMPLET\s+"'+name+r'"\s*\{([^{}]*)\}',text));assert len(matches)==1
m=matches[0];t=declaration(m[1]);assert not t['unsupported']
assert t['fields']['MeshName']==normal['fields']['MeshName'] and t['fields']['DrawCount']==0
t.update({'name':name,'kind':'mesh','source':{**normal['source'],'byteOffset':m.start(),'line':text.count('\n',0,m.start())+1},
          'declarationSha256':sha(m[0].encode('latin1'))})
for key in ['glb','poseData','textures','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate']:
 if key in normal:t[key]=copy.deepcopy(normal[key])
t['convertedArtifactReuse']={'template':normal['name'],'meshName':normal['fields']['MeshName'],
 'reason':'Identical original invisible X_SKIN_MESH helper; same existing conversion/pose, independent original template events and lifetime'}
initial={e['property']:e['value'] for e in t['events'] if e['start']==0 and not e['fade']}
runtime={**t,'initialSize':initial.get('Size'),'initialVelocity':initial.get('Velocity'),
 'initialDirSpeed':initial.get('DirSpeed'),'initialAnimation':{'name':initial['AniName']['animation'],'playback':initial['AniName']['playback']},
 'missingExplicitTickRate':t['animationMissingTickRate']}

blocks=[
 block(0x327f8171,0x102,'Original START/LOOP/END registrations: init +20, StartFuture +30, Event +50, received Frame +40; offsets shift with PUSH'),
 block(0x327f8451,0x69,'Original SDK_XX / SDK_XXX registration, distinct from fixed-V5 2026 SDKComboChain'),
 *[block(a,5,'Registered thunk to recovered original callback') for a in [
   0x328006c0,0x328006d0,0x328006e0,0x328006f0,0x32800760,
   0x32800c30,0x32800c40,0x32800c50,0x32800c60,0x32800c70,0x327ffa90]],
 block(0x327c7670,0x18,'Counter reset future callback used by preceding SCA_ZZ'),
 block(0x327c76c0,0x16,'LOOP StartFuture increments unsigned word7170 after common'),
 block(0x327e21b0,0xfd,'START: buffered Z dispatch before fresh input and stopped fallback WAIT'),
 block(0x327e24e0,0x10a,'LOOP1: buffered Z dispatch, fresh Z if counter<4, stopped fallback END'),
 block(0x327e2820,0x10a,'LOOP2: same priority, alternates to LOOP1, stopped fallback END'),
 block(0x327e2b60,0x2a,'END: stopped fallback WAIT'),
 block(0x327e0230,0x67,'SDK_XX: freshX/freshZ latches, landing Z then X then XX_LANDING; no .5 dispatch or end-fall'),
 block(0x327ecba0,530,'START: .43 / MP3 normal set, followed by common received frame'),
 block(0x327ecdc0,998,'LOOP1: .01 Uppercut and .25 normal, each MP3, then common received frame'),
 block(0x327ed1b0,998,'LOOP2: .08 normal and .31 Uppercut, each MP3, then common received frame'),
 block(0x327ed5a0,528,'END: .37 / MP3 distinct Finish set, then common received frame'),
 block(0x327ec990,528,'SDK_XXX: .01 / MP3 Uppercut, after third-X landing successor'),
 block(0x3306e6f4+0x61c,4,'Original EL CommonFrameMove vtable entry',True),
 block(0x327f93d0,0xb,'EL CommonFrameMove starts by calling shared received frame31fa1220'),
 block(0x31d0cd70,0x30,'Animation oneshot predicate: previous<t<=now'),
]
contract={'schemaVersion':1,'id':'ca-commands-native-v58','originalClientExecuted':False,'rawConfigurationChanged':False,
 'evidenceClass':'Original2016 hashchecked declarations plus bounded exact-byte static decode from existing static analysis derived snapshot; no client trajectory measured',
 'source':{'path':str(source),'sha256':expected,'bytes':len(raw),
   'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
   'qualification':'Existing late snapshot3 may be non-atomic. Derived PE and original file identities are distinct.'},
 'sources':{k:profile['sources'][k] for k in ['enum','elesis','effect','damage']},'blocks':blocks,
 'constants':[scalar(a,v) for a,v in [(0x33035f7c,.43),(0x32fe77f0,.01),(0x32fe77f8,.25),
  (0x33038b54,.08),(0x33061654,.31),(0x3306e580,.37),(0x3306af70,3)]],
 'states':states,'effectSets':sets,'damageEffects':damage,'effectTemplates':{name:runtime},
 'producerRows':{'ESI_DASH_COMBO_SCA_ZZZ_START':[[.43,set_names[0]]],
  'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1':[[.01,set_names[1]],[.25,set_names[0]]],
  'ESI_DASH_COMBO_SCA_ZZZ_LOOP_2':[[.08,set_names[0]],[.31,set_names[1]]],
  'ESI_DASH_COMBO_SCA_ZZZ_END':[[.37,set_names[2]]]},
 'commonQueueEvidence':['contracts/add-analysis-v53/MM_COMMAND_FURY_PRODUCER_2016.md','contracts/add-analysis-v53/ADD_AWAKE_STATE_PRODUCER_PASS2_2016.md'],
 'decisions':['Raw .05 effect-set entries remain active; explicit frame producers run in addition to the common queue, not as replacements.',
  'A full four-loop chain has five raw queue waves, nine explicit ordinary/Uppercut waves and one Finish wave. Interrupted/early-release paths retain their actual lower count.',
  'LOOP animation-stopped fallback always selects END, including below counter4. A buffered branch has priority over stopped fallback.',
  'SDK_XX retains both latches until actual support, then Z before X before XX_LANDING. Fixed-V5 2026 .5 chain is superseded for this callback.',
  'Finish uses its own original REACT5 / BACK_SPEED_X1500 / Y700 and1.33 scale; the character END DD stays unchanged.',
  'Declared character damage remains; a report saying only projectile damage is not evidence to erase original DD.'],
 'limits':['Bounded disassembly is not a recursively recovered original call graph or original-client dynamic acceptance.',
  'Existing shared reaction, animation and collision consumers remain qualified Web/Native adapters.',
  'Source literal resource failure particles remain unsupported unless their independent closure is established.']}
visual={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,'templates':{name:t},
 'sourceFiles':[t['source']],'limits':['Invisible original helper reuses the already converted identical mesh pose; no guessed visual mesh.']}
closure={'schemaVersion':1,'id':'ca-command-closure-v58','originalClientExecuted':False,
 'sources':{k:profile['sources'][k] for k in ['effect','damage']},
 'effectSets':{set_names[2]:sets[set_names[2]]},'damageEffects':{next(iter([n for n in damage if n.endswith('_Finish')])):damage[next(iter([n for n in damage if n.endswith('_Finish')]))]},
 'effectTemplates':{name:runtime}}
for p,v in [('contracts/ca-commands-native-v58.json',contract),('contracts/ca-finish-visual-v58.json',visual),('contracts/ca-command-closure-v58.json',closure)]:
 (ROOT/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
print(json.dumps({'blocks':len(blocks),'originalClientExecuted':False,'sets':len(sets),'finishDeclaration':t['declarationSha256']}))
