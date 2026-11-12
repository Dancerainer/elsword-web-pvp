"""Seal bounded existing-capture Blood Cutter delay evidence; never run a target."""
from pathlib import Path
import gzip
import hashlib
import json
import struct
import sys

sys.dont_write_bytecode = True
sys.path[:0] = ['asset_sources/analysis/offline-libs', str(Path(__file__).parent)]
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
from kl82_static import parse, read_declarations

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
NPC = Path('asset_work/raw/data/data037.kom/Elesis_BloodCutter.lua')
RTTI = Path('asset_sources/upstream/reports/analysis/full-native/rtti-catalog.json.gz')

sha = lambda data: hashlib.sha256(data).hexdigest()
with SOURCE.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == EXPECTED
    stream.seek(0)
    header = stream.read(4096)
    pe = struct.unpack_from('<I', header, 60)[0]
    optional = pe + 24
    base = struct.unpack_from('<I', header, optional + 28)[0]
    count = struct.unpack_from('<H', header, pe + 6)[0]
    size = struct.unpack_from('<H', header, pe + 20)[0]
    sections = [struct.unpack_from('<IIII', header, optional + size + i * 40 + 8)
                for i in range(count)]

    def block(address, length, purpose):
        for virtual_size, rva, raw_size, offset in sections:
            if base+rva <= address and address+length <= base+rva+min(virtual_size, raw_size):
                source_offset = offset+address-base-rva
                stream.seek(source_offset)
                data = stream.read(length)
                assert len(data) == length
                return {'address': hex(address), 'fileOffset': source_offset,
                        'bytes': length, 'sha256': sha(data), 'hex': data.hex(), 'purpose': purpose}
        raise ValueError('Unbacked native range: '+hex(address))

    consumer = block(0x320bdaa0, 0x683, 'Original paired-deque NPC request delay consumer')
    assert consumer['sha256'] == 'c02fa337949edd5d75f11c63e284d22ec7da47507a808aedaa7aa64e24a89d8c'
    decoded = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(bytes.fromhex(consumer['hex']), 0x320bdaa0))
    assert sum(i.size for i in decoded) == consumer['bytes']
    assert decoded[-1].mnemonic == 'ret' and decoded[-1].op_str == '4'
    assert decoded[-1].address+decoded[-1].size == 0x320be123
    predicates = {
        0x320bdbf5: ('fsub', 'dword ptr [esp + 0x88]'),
        0x320bdc07: ('fstp', 'dword ptr [eax]'),
        0x320bde9c: ('fcomp', 'dword ptr [eax + ecx*4]'),
        0x320bdfa0: ('push', '0xa9'),
        0x320bdfa5: ('call', '0x320d87b0'),
    }
    instructions = {i.address: i for i in decoded}
    for address, (mnemonic, operands) in predicates.items():
        assert (instructions[address].mnemonic, instructions[address].op_str) == (mnemonic, operands)
    pvp = block(0x3265ad20, 653, 'RTTI-bound CX2PVPGame frame method: forwards its original float elapsed to delay consumer')
    elapsed = block(0x3265af98, 15, 'fld original frame float entryESP+0xc; push float; call320bdaa0')
    assert elapsed['hex'] == 'd9442410518bced91c24e8f92aa6ff'
    cleanup = block(0x31effc90, 0x11e, 'Same-callback temporary DUMMY DestroyInstance(pointer&,false); clears the pointer and manager instance')
    dummy_end = block(0x327fc1f5, 0x17, 'After NPC request: global damage manager +368, push false, address of saved dummy pointer, call31effc90')
    delay = block(0x3300da54, 4, 'NPC request float32 delay argument8')
    assert struct.unpack('<f', bytes.fromhex(delay['hex']))[0] == struct.unpack('<f', struct.pack('<f', .3))[0]

rtti_bytes = RTTI.read_bytes()
rtti = json.loads(gzip.decompress(rtti_bytes))
assert rtti['sourceSha256'] == EXPECTED
descriptor = next(row for row in rtti['typeDescriptors'] if row['decoratedName'] == '.?AVCX2PVPGame@@')
locator = next(row for row in rtti['locators'] if row['descriptor'] == descriptor['address'])
vtable = next(row for row in locator['vtables'] if row['address'] == '0x3304d8dc')
assert vtable['targets'][1] == '0x3265ad20'

npc_bytes = NPC.read_bytes()
assert sha(npc_bytes) == 'cfe229e11f92a42b66ae84529fa1090e1688fc1992917b51c971dd7ddf41c8d2'
chunk = parse(npc_bytes)
globals_ = read_declarations(NPC, capture_calls=True, capture_unresolved=True)['globals']
walk = globals_['ELESIS_FIRE_WALL_WALK_FRAME_MOVE']['$prototype']
prototype = chunk['prototypes'][walk]
assert prototype['numbers'] == [.01, .1]
assert {'AnimEventTimer_LUA', 'PlayEffectSetTraceTarget_LUA',
        'EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile', 'SetPassiveSpeed'} <= set(prototype['gc'])

result = {
    'schemaVersion': 1,
    'evidenceClass': 'target2016 historical snapshot source-bound static bytes + original KL static parse; no target execution',
    'targetExecuted': False,
    'source': {'path': str(SOURCE), 'sha256': EXPECTED,
               'qualification': 'Existing late snapshot3 derived analysis PE; capture can be non-atomic; not the original on-disk EXE identity.'},
    'casterBinding': 'contracts/elesis-native-consumers-v37.json#/bloodCutter',
    'request': {'animationGate': .01, 'npcId': 1641, 'floatArgumentDwordIndex': 8,
                'delay': delay,
                'semantics': 'Capture position, facing and request metadata when the caster timer creates the temporary dummy and queues the request. The float is a separate delay, not a second animation gate.'},
    'clock': {'pvpMethod': pvp, 'forwardSite': elapsed,
              'class': descriptor['decoratedName'], 'rttiCatalog': str(RTTI), 'rttiCatalogSha256': sha(rtti_bytes),
              'vtable': vtable['address'], 'slot': '0x4',
              'meaning': 'The original CX2PVPGame frame method always forwards its unmodified float elapsed argument at the final branch join, after ordinary unit processing. This path does not consult the caster animation, STOP or skill state.'},
    'consumer': {'function': consumer, 'pairedDequeOffsets': {'requests': '0x3e4', 'remainingSeconds': '0x3fc'},
                 'subtractSite': '0x320bdbef..0x320bdc17', 'readyPrefixSite': '0x320bde73..0x320bdec7',
                 'releaseSite': '0x320bdf92..0x320bdfa5', 'protocolEvent': '0xa9',
                 'meaning': 'Subtract the frame float from stored delays and release only the corresponding request prefix whose delays are <=0. These are parallel deques, not a float-key map.',
                 'cancellationBoundary': 'Game-state2 clears both queues; an additional game+36d/request+68 policy exists. The delay consumer does not look up caster life or current skill.'},
    'temporaryDummy': {'casterCleanupSite': dummy_end, 'callee': cleanup,
                       'meaning': 'The caster destroys its saved dummy instance in the same callback after queuing NPC1641. It must not become an independently living permanent melee damage effect.'},
    'npcScript': {'path': str(NPC), 'sha256': sha(npc_bytes), 'bytes': len(npc_bytes),
                  'walkFunction': 'ELESIS_FIRE_WALL_WALK_FRAME_MOVE', 'walkPrototype': walk,
                  'prototypeWords': prototype['instructions'], 'constants': prototype['gc'], 'numbers': prototype['numbers'],
                  'interpretation': ['pc0..5 tests NPC animation timer .01.',
                                     'pc6..19 traces the Projectile set to NPC using GetOwnerGameUnit and GetEffectSet.',
                                     'pc20..30 tests NPC animation timer .1 and sets passive speed(2000,0).'],
                  'qualification': 'NPC-local .01 visual birth and .1 motion belong to a later clock after request release and NPC creation; they are distinct from caster .01 and request .3.'},
    'limits': ['No original target process, original DLL or live capture was executed.',
               'Packet transport, ACK latency and actual target-client frame quantization were not measured.',
               'Whole-game pause semantics upstream of the frame callback are outside this proof.',
               'The current Web adapter must state how it represents delayed request release and the subsequent NPC-local timer; no simple animationTime>=.31 substitution.',
               'The older fixed-V5 CreateNPCReq formal fDelayTime is corroborating nomenclature, not the evidence for this captured2016 queue clock.'],
}
(ROOT/'contracts/elesis-blood-cutter-delay-v37.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'consumerSha256': consumer['sha256'], 'pvpMethodSha256': pvp['sha256'],
                  'dummyCleanupSha256': cleanup['sha256'], 'npcSha256': sha(npc_bytes)}))
