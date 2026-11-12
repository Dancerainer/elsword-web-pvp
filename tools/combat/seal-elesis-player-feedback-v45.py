"""Seal bounded offline2016 disassembly; no target or source Lua is executed."""
from pathlib import Path
import hashlib
import json
import struct
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, 'asset_sources/analysis/offline-libs')
from capstone import Cs, CS_ARCH_X86, CS_MODE_32

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED = 'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
sha = lambda b: hashlib.sha256(b).hexdigest()
raw = SOURCE.read_bytes()
assert sha(raw) == EXPECTED
pe = struct.unpack_from('<I', raw, 60)[0]
optional = pe+24
base = struct.unpack_from('<I', raw, optional+28)[0]
count, size = struct.unpack_from('<H', raw, pe+6)[0], struct.unpack_from('<H', raw, pe+20)[0]
sections = [struct.unpack_from('<IIII', raw, optional+size+i*40+8) for i in range(count)]

def offset(address):
    for virtual_size, rva, raw_size, start in sections:
        if base+rva <= address < base+rva+min(virtual_size, raw_size):
            return start+address-base-rva
    raise ValueError(hex(address))

def block(label, start, length, purpose):
    data = raw[offset(start):offset(start)+length]
    decoded = list(Cs(CS_ARCH_X86, CS_MODE_32).disasm(data, start))
    assert sum(i.size for i in decoded) == length, label
    return {'id': 'native-v45-'+label, 'address': hex(start), 'bytes': length,
            'fileOffset': offset(start), 'sha256': sha(data), 'hex': data.hex(),
            'purpose': purpose,
            'instructions': [{'address': hex(i.address), 'bytes': i.bytes.hex(),
                              'mnemonic': i.mnemonic, 'operands': i.op_str} for i in decoded]}

specs = [
 ('leap-registration', 0x327fe6ff, 0x7f, 'Exact ESI_SI_A_EL_LEAP_CRASH_JUMP/landing registration and thunk roots'),
 ('leap-launch', 0x327ee790, 0x79, 'Registered StartFuture: active vector2200/1000; positive accumulator selects2700'),
 ('dash-accumulator', 0x327f94d1, 0x34, 'Dash state predicate accumulates+7194; skill28204 retains the accumulator'),
 ('ca-zz-loop-registration', 0x327f81b7, 0x83, 'Both original loop states install same incrementing StartFuture'),
 ('ca-zz-loop-start', 0x327c76c0, 0x16, 'CommonStartFuture then increment unsigned counter+7170'),
 ('ca-zz-loop-budget', 0x327e2556, 0x12, 'Fresh Z and unsigned counter below4 gate original repeat buffer'),
 ('ca-air-xxx-registration', 0x327f847d, 0x46, 'Original 668XXX registered event/frame callbacks'),
 ('ca-air-xxx-wave', 0x327ec990, 0x210, '.01 timer; FlushMP3; original Uppercut effect-set creation'),
 ('ca-dash-xz-wave', 0x327cc130, 0x23e, '.01 timer; native MP5 and charge-dependent projectile creation'),
 ('ca-dash-xz-charge-thunks', 0x327ffad0, 0x15, 'Registered charge Event/Frame thunks lead327c8100/327c8150'),
 ('ca-dash-xz-charge', 0x327c8100, 0x8c, 'Key-up/max3.1 event and accumulator+710c capped3 seconds'),
 ('firewall-npc-callback', 0x327dead0, 0x123, 'Original .01 callback requests NPC1635 at current position, not old-V5 damage projectile'),
 ('firewall-passive-setter', 0x31dff0f0, 0x17, 'Setter writes passive X/Y only, leaving current speed for original NPC physics'),
 ('firewall-now-physics-call', 0x3253ab0d, 0xc, 'NPC Now invokes RTTI vtable+364 physics before passive speed hand-off'),
 ('firewall-now-passive-copy', 0x3253ad17, 0x67, 'After physics, non-reaction branch copies passive X/Y to current X/Y unless passive sentinel is-1'),
 ('firewall-current-x-integration', 0x325310c1, 0x43, 'Positive current X is reduced by reload acceleration times frame elapsed before displacement integration'),
 ('injection-native', 0x327fc230, 0x443, '.2 callback removes433/applies470; source burst plus persistent buff ownership'),
 ('brandish-frame', 0x327fb3a0, 0x302, 'Native .15 counter through6, dummy coefficient43.38, self-HP helper1/30'),
 ('brandish-self-cost', 0x327fa520, 0x405, '20percent exemption, damage-data copy, GetFinalDamage,10percent floor and666 multiplier'),
 ('bh-zx-ready-start', 0x327c8030, 0x1b, 'Native five-fireball budget initialization'),
 ('bh-zx-loop-start', 0x327c8050, 0x10, 'Native loop decrements remaining shots'),
 ('bh-zx-loop-event', 0x327cbdb0, 0x10e, 'Fresh X / original window / animation-end re-entry before landing'),
 ('bh-zx-loop-frame', 0x327cbec0, 0x26e, 'Original .1 timer, MP2, Dummy2_Lhand, downward45-degree launch and passive variant'),
 ('gm-spin-native', 0x327f74e0, 0x449, 'Original staged repeated-X spin callback; does not prove requested free-cancel window'),
]
blocks = [block(*row) for row in specs]
constants = []
for name, address, fmt, expected in [
 ('leap-horizontal',0x3306ed78,'f',2200),('leap-horizontal-dash',0x3306ed74,'f',2700),
 ('leap-vertical',0x3306af30,'f',1000),('one-shot',0x32fe77f0,'f',.01),
 ('brandish-interval',0x32febd98,'d',.15),('brandish-cost-multiplier',0x3307036c,'f',1/30),
 ('hp-exemption',0x32ff11b8,'d',.2),('hp-floor',0x32fe95e8,'d',.1),
 ('overflow-reduction',0x3306fbe8,'d',.6667),('bh-zx-shot-time',0x32fe95e0,'f',.1),
 ('bh-zx-mp',0x3306ae98,'f',2),('ca-air-xxx-mp',0x3306af70,'f',3),
 ('ca-dash-xz-mp',0x3306af84,'f',5),('ca-dash-xz-charge-max',0x32fe9b50,'d',3),
 ('ca-dash-xz-release',0x3306af74,'f',3.1),('ca-dash-xz-power',0x32fdeb98,'d',.5),
 ('ca-dash-xz-size',0x3306d9c8,'d',.13300000131130219),('ca-dash-xz-unresolved-vector-z',0x3305c878,'d',.3330000042915344),
 ('npc-passive-sentinel',0x32fe80e8,'f',-1)]:
    data=raw[offset(address):offset(address)+struct.calcsize(fmt)]
    value=struct.unpack('<'+fmt,data)[0]
    assert abs(value-expected)<1e-6,(name,value)
    constants.append({'id':'native-v45-'+name,'address':hex(address),'value':value,
                      'hex':data.hex(),'sha256':sha(data),'format':'little-endian-'+fmt})

report = {'schemaVersion':1,'id':'elesis-player-feedback-native-v45',
          'targetClientMeasured':False,'targetExecuted':False,
          'evidenceClass':'offline exact-byte static decode from existing source-bound static analysis snapshot; no provider decompilation or dynamic trajectory claimed',
          'source':{'path':str(SOURCE),'sha256':EXPECTED,'bytes':len(raw),
                    'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
                    'qualification':'Existing late snapshot3 may be non-atomic. Derived PE and original client identities remain distinct.'},
          'blocks':blocks,'constants':constants,
          'limits':['Function boundaries here are bounded direct-flow ranges, not a newly recovered provider call graph.',
                    'The full2016 GetFinalDamage wrapper and original-client combat trajectory were not executed.',
                    'GM requested free cancellation and CA finish no-down are user policies, not rewritten original declarations.',
                    'The native launch positive-accumulator branch is mapped to prior dash history by target skill description.']}
output=ROOT/'contracts/elesis-player-feedback-native-v45.json'
output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'file':str(output),'blocks':len(blocks),'constants':len(constants),'sha256':sha(output.read_bytes())}))
