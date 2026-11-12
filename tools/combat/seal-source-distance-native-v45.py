"""Seal the original 2016 sound, world-color and unit-stop distance consumers.

Read-only inputs. No client execution, static analysis target changes, network, or upstream
writes. The frozen source is a 2026 reference, never the original PE's source.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parents[2]


class Image:
    def __init__(self, path, sha256):
        self.path = path
        self.data = Path(path).read_bytes()
        self.sha256 = hashlib.sha256(self.data).hexdigest()
        assert self.sha256 == sha256, (path, self.sha256)
        pe = struct.unpack_from('<I', self.data, 60)[0]
        opt = pe + 24
        self.base = struct.unpack_from('<I', self.data, opt + 28)[0]
        size = struct.unpack_from('<H', self.data, pe + 20)[0]
        count = struct.unpack_from('<H', self.data, pe + 6)[0]
        self.sections = [struct.unpack_from('<IIII', self.data, opt + size + i * 40 + 8)
                         for i in range(count)]
        self.exports_rva = struct.unpack_from('<I', self.data, opt + 96)[0]

    def offset(self, address):
        for vs, rva, rs, start in self.sections:
            if self.base + rva <= address < self.base + rva + min(vs, rs):
                return start + address - self.base - rva
        raise ValueError(hex(address))

    def read(self, address, size):
        start = self.offset(address)
        return self.data[start:start + size]

    def scalar(self, address, kind):
        return struct.unpack('<' + kind, self.read(address, struct.calcsize(kind)))[0]

    def span(self, name, start, end, raw=False):
        value = self.read(start, end - start)
        result = {'name': name, 'start': hex(start), 'endExclusive': hex(end),
                  'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}
        if raw:
            result['hex'] = value.hex()
        else:
            result['first24Bytes'] = value[:24].hex()
        return result

    def exports(self):
        e = self.base + self.exports_rva
        _, _, _, _, _, _, _, count, funcs, names, ordinals = struct.unpack('<IIHHIIIIIII', self.read(e, 40))
        rows = {}
        for index in range(count):
            rva = self.scalar(self.base + names + index * 4, 'I')
            offset = self.offset(self.base + rva)
            name = self.data[offset:].split(b'\0', 1)[0].decode('ascii')
            ordinal = self.scalar(self.base + ordinals + index * 2, 'H')
            rows[name] = self.scalar(self.base + funcs + ordinal * 4, 'I')
        return rows


pe = Image('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe',
           'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba')
fmod = Image('asset_sources/client/data/fmodex.dll',
             '2d81269d422cc54384c39d868ce4780029c324c3f96182a25afa8a00255f5a98')
assert pe.scalar(0x32ff8db0, 'f') == 800
assert pe.scalar(0x32ff80a8, 'f') == 700
assert pe.scalar(0x33011b64, 'f') == 1300
assert pe.scalar(0x33011b68, 'f') == 2000
assert pe.scalar(0x33010608, 'f') == 640000
assert pe.scalar(0x32fea468, 'd') == 6
assert pe.read(0x31d22942, 5) == bytes.fromhex('6800002000')
assert fmod.read(0x100a1c5b, 6) == bytes.fromhex('81f900002000')
assert fmod.read(0x100a5741, 12) == bytes.fromhex('d99e84010000d99e88010000')

references = []
for path, methods in [
    ('.cache/native-source-runtime/X2Lib/X2GameUnit.cpp', ['PlaySound:5055']),
    ('.cache/native-source-runtime/X2Lib/X2GameUnit.h', ['SoundPlayData:1346', 'PlaySound defaults:2489']),
    ('.cache/native-source-runtime/X2Lib/X2GUUser.cpp', ['STOP_ALL entry:13762', 'sound parser:14551',
        'timed stops and sound:18123', 'ActiveSkillShow:23255', 'stop setters:26980',
        'cut-in preferences:32929', 'world-color distance:32952']),
    ('.cache/native-source-runtime/X2Lib/X2Game.cpp', ['listener:2684', 'StopOtherUnit:4124',
        'StopAllUnit:4167', 'Stop2OtherUnit:4227', 'Stop2AllUnit:4267']),
    ('.cache/native-source-runtime/X2Lib/X2Game.h', ['GAME_TYPE enum:61']),
    ('.cache/native-source-runtime/X2Lib/X2Define.h', ['LIMIT_DISTANCE:31']),
    ('.cache/native-source-runtime/KTDXLIB/KTDXDeviceSound.h', ['Play/Set3DPosition/SetMax3DDistance:17']),
    ('.cache/elesis-v45/X2GUEL-exact.cpp', ['ShowActiveSkillCutInAndLight:3776']),
]:
    blob = (ROOT / path).read_bytes()
    references.append({'path': path, 'sha256': hashlib.sha256(blob).hexdigest(),
                       'evidence': 'frozen fixed-V5 2026 source reference, not 2016 source', 'methods': methods})

decl_path = '.cache/elesis-v45/declarations/elsword-declarations.json'
decl = json.loads((ROOT / decl_path).read_text(encoding='utf-8'))
gm = {name: {'sourcePc': decl['locations'][name],
             'sounds': {key: row for key, row in decl['globals'][name].items()
                        if key.startswith('SOUND_PLAY')}}
      for name in ['ESI_SGM_START', 'ESI_START']}
assert all(row['4'] == 1 for state in gm.values() for row in state['sounds'].values())

exports = fmod.exports()
fmod_export_names = ['FMOD_Channel_Set3DAttributes', 'FMOD_Sound_Set3DMinMaxDistance',
                    'FMOD_Channel_Set3DMinMaxDistance', 'FMOD_Sound_SetMode',
                    'FMOD_System_Set3DSettings', 'FMOD_System_Set3DListenerAttributes']
fmod_spans = [
    fmod.span('exact mode 0x200000 linear distance gain', 0x100a1c20, 0x100a1cd0, True),
    fmod.span('actual Euclidean distance and gain consumer', 0x100a1db8, 0x100a1e16, True),
    fmod.span('actual gain dispatch', 0x100a1f37, 0x100a1f4d, True),
    fmod.span('channel min/max setter export', 0x10096730, 0x1009675d, True),
    fmod.span('channel min/max setter wrapper', 0x100718a0, 0x100718d0, True),
    fmod.span('channel min/max fields', 0x100a56b0, 0x100a574d),
]
native_spans = [
    pe.span('GM common state SOUND_PLAY local-only vs spatial branch', 0x31f54551, 0x31f545ad, True),
    pe.span('common frame timed sound and stop consumer', 0x31f535d0, 0x31f546df),
    pe.span('unit PlaySound', 0x321e7440, 0x321e75b8),
    pe.span('sound Set3DPosition', 0x31d22610, 0x31d22628, True),
    pe.span('3D sound mode creation and min/max setup', 0x31d228b1, 0x31d2294d, True),
    pe.span('runtime custom max setter', 0x31d22c80, 0x31d22d25),
    pe.span('3D sound capability/use fallback', 0x31d22ad3, 0x31d22b58, True),
    pe.span('sound manager distance factor default', 0x31d01a8f, 0x31d01a98, True),
    pe.span('FMOD system distance units settings', 0x31d01c8a, 0x31d01ca5, True),
    pe.span('listener forwards camera coordinates', 0x320ccdbd, 0x320ccddb, True),
    pe.span('listener FMOD attributes forwarder', 0x31d018b0, 0x31d0195e),
    pe.span('world-color and cut-in distance gate', 0x31f2f650, 0x31f2f6ef, True),
    pe.span('cut-in preference gate with original numeric options', 0x31f3d120, 0x31f3d200),
    pe.span('world-color writer', 0x31f3d200, 0x31f3d2e7),
    pe.span('CHANGE_WORLD_COLOR per-frame guard', 0x31fa8840, 0x31fa8850, True),
    pe.span('class cut-in distance and preference guards', 0x327ee5de, 0x327ee5fc, True),
    pe.span('STOP_ALL immediate original PvP vs other radii', 0x31f9585a, 0x31f95955),
    pe.span('STOP_ALL timed original same bands and caster override', 0x31f53b71, 0x31f53c4b),
    pe.span('STOP_OTHER timed original PvP vs other radii', 0x31f53f31, 0x31f53feb),
    pe.span('game StopOtherUnit receiver iterator', 0x3209efa0, 0x3209f09a),
    pe.span('game StopAllUnit receiver iterator', 0x3209f0a0, 0x3209f1bb),
    pe.span('game Stop2OtherUnit receiver iterator', 0x3209f1c0, 0x3209f2ba),
    pe.span('game Stop2AllUnit receiver iterator', 0x3209f2c0, 0x3209f3dc),
    pe.span('actor StopTime source-record setter, differs from fixed V5', 0x31f57c30, 0x31f57dd3),
    pe.span('actor Stop2Time source-record setter, differs from fixed V5', 0x31f57de0, 0x31f57eeb),
    pe.span('actor StopTime source-record decay and last-record selection', 0x31f90dd1, 0x31f90ee5),
    pe.span('actor Stop2Time independent source records and +5dc8 selection', 0x31f90f23, 0x31f91035),
    pe.span('StopTime OR Stop2Time gates future state and frame processing', 0x31f91035, 0x31f9106f, True),
    pe.span('frame-stop gates future animation advancement', 0x31fa09c8, 0x31fa0a0f, True),
    pe.span('frame-stop gates future physics', 0x31fa0f03, 0x31fa0f1c, True),
    pe.span('3D Euclidean distance helper', 0x31c18000, 0x31c1805a, True),
    pe.span('3D squared distance helper', 0x31c6e880, 0x31c6e8cd, True),
]
report = {
    'schemaVersion': 1, 'id': 'source-distance-native-v45', 'clientMeasured': False,
    'originalPe': {'path': pe.path, 'sha256': pe.sha256,
                   'originalClientSha256': 'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729'},
    'originalFmodDll': {'path': fmod.path, 'sha256': fmod.sha256,
                        'preferredImageBase': hex(fmod.base), 'snapshotRuntimeBase': '0x5f580000',
                        'exports': {name: hex(exports[name]) for name in fmod_export_names}},
    'fixedReference': {'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
                       'label': '2026 reconstruction, not original 2016 source', 'files': references},
    'gmStartDeclaration': {'source': decl['source'], 'extraction': decl_path,
        'extractionSha256': hashlib.sha256((ROOT / decl_path).read_bytes()).hexdigest(), 'states': gm},
    'sound': {
        'onlyIfMyUnit': {'scriptField': 'SOUND_PLAY[n][4]', 'default': False,
            'ifTrue': 'discard for non-local actor; local actor plays 2D without spatial attenuation',
            'nativeGuard': '0x31f54551..0x31f54594'},
        'ordinarySound': {'default3D': True, 'source': 'actor GetPos() world XYZ',
            'listener': 'current camera eye world XYZ; orientation is normalized camera look/up',
            'positionScalingAtSubmission': 1, 'distanceMetric': 'Euclidean XYZ world units',
            'defaultDistanceFactor': 800, 'fmodDopplerScale': 1, 'fmodRolloffScale': 1,
            'defaultMinDistance': 80, 'defaultMaxDistance': 4800,
            'defaultMaxProducer': '6 * sound-manager distance factor',
            'minProducer': 'float32(0.10000000149011612 * sound-manager distance factor)',
            'mode': '0x200000', 'gain': '1 for d<=min; (max-d)/(max-min) for min<d<max; 0 for d>=max',
            'curveEvidence': 'actual original fmodex.dll arithmetic; not assumed from SDK enum names',
            'disabled3DFallback': '2D when device/manager 3D capability, enable, sound-use or Play 3D flag is false',
            'customMax': 'original SetMax3DDistance supported; do not apply a guessed override to every SOUND_PLAY row',
            'scope': 'local audio device consumer for locally represented actors, not a packet broadcast in these functions'},
    },
    'worldColorAndCutIn': {
        'pvpGameType1': 'gate returns true regardless of distance',
        'dungeonGameType2': 'gate returns true regardless of distance',
        'distanceBranches': {'nativeGameTypeIds': [3, 4], 'comparison': 'actor-to-local-player squared XYZ distance < 640000',
            'radius': 800, 'selfAlwaysPasses': True, 'type3FrozenName': 'GT_BATTLE_FIELD',
            'type4Name': 'unknown; not in frozen reference enum'},
        'worldColor': 'local world render color, controlled by source CHANGE_WORLD_COLOR/state callback; no continuous distance fade in PvP',
        'cutInPreference': 'additional original local preference gate; numeric 1=self, 2=other party members, 3=self or party; other values false, plus special exclusions',
        'fixedV5Difference': '2026 header uses a different three-value cut-in enum; do not transplant its numeric values to the original',
        'flashLimit': 'gate proven; exact screen-clear framebuffer flash pass and every class-specific light producer not fully audited'},
    'unitStop': {
        'metric': 'caster position to each recipient actor world XYZ Euclidean distance; never camera distance',
        'pvpGameType1': {'fullRadius': 1300, 'halfRadius': 2000,
                'fullDurationWhen': 'd < 1300', 'halfDurationWhen': '1300 <= d < 2000', 'noneWhen': 'd >= 2000'},
        'nativeOtherModes2To4': {'fullRadius': 700, 'halfRadius': 800,
                'fullDurationWhen': 'd < 700', 'halfDurationWhen': '700 <= d < 800', 'noneWhen': 'd >= 800'},
        'curve': 'two hard steps, implemented as half-duration outer call then full-duration inner call; no continuous falloff',
        'all': 'iterates local unit list; positive source own-duration override bypasses distance for source actor',
        'other': 'excludes source; same-team exclusion when explicitly requested or in native modes 2/3/4; PvP ordinary call includes other players of both teams',
        'noPositionOrNonpositiveRadius': 'unbounded receiver iteration',
        'stopAndStop2': 'both have corresponding spatial receiver iterators',
        'rawTuples': {'STOP_ALL_UNIT/STOP2_ALL_UNIT': ['triggerTime', 'duration', 'casterOwnDuration'],
                      'STOP_OTHER_UNIT/STOP2_OTHER_UNIT': ['triggerTime', 'duration'],
                      'otherTeam': 'API-only final bool; original script consumers pass false, not raw tuple[3]'},
        'stop2Runtime': {'stopTimeField': 'actor+0x5dc4', 'stop2TimeField': 'actor+0x5dc8',
            'frameStopFlag': 'actor+0x5e27',
            'gate': 'either positive timer freezes future state/frame, animation and physics',
            'independence': 'separate source-record queues, setters and clear operations; do not alias their lifetime into one timer',
            'effectClockLimit': 'this does not prove that every independent DamageEffect/particle world clock is frozen'},
        'nativeSetterCaveat': 'source UID/time records and invincibility-related guard exist; fixed V5 direct scalar assignment is not exact 2016',
        'originalRecordConsumer': '0x31f90dd1..0x31f90ee5 decrements each record, can delete by source state, then selects last record remaining for +5dc4; not a proven generic maximum aggregator',
        'networkCaveat': 'proven functions are local actor consumers; the full input/state transport route is outside this narrow audit'},
    'implementationPolicy': [
        'First preserve SOUND_PLAY[4] actor ownership through start-pose/event/network playback; enemy GM start audio is suppressed regardless of map length.',
        'For ordinary 3D world sounds, apply original camera-to-source XYZ linear gain separately from user volume and measured peak mixing; retain explicit 2D system/local-only sounds.',
        'Keep PvP source world-color behavior global; do not impose the audio cutoff or unit-stop radius on it.',
        'Qualify any cut-in/light UI policy independently using distance gate plus local preference evidence; do not invent a common threshold.',
        'For source STOP/STOP2 requests apply strict recipient radii and two duration bands, while preserving existing source-specific setters and owner authority.',
    ],
    'unknown': ['Exact FMOD stereo pan/doppler and audio hardware behavior are not reconstructed.',
                'No original-client audio capture, timing trace or battle measurement was made.',
                'Exact framebuffer screen-clear flash producer and all per-class flash paths remain unverified.',
                'Native game type 4 name and current runtime sound distance-factor overrides remain unresolved.'],
    'nativeSpans': native_spans, 'fmodSpans': fmod_spans,
}
inventory = []
for path in sorted((ROOT / 'packages/combat-core').glob('*-profile.json')):
    blob = path.read_bytes()
    profile = json.loads(blob)
    counts = {}
    extended_other = []
    for state_name, state in profile.get('states', {}).items():
        for key, row in state.get('raw', {}).items():
            if key.startswith(('STOP_ALL_UNIT', 'STOP_OTHER_UNIT', 'STOP2_', 'STOP_MY_UNIT')):
                family = key.rstrip('0123456789')
                counts[family] = counts.get(family, 0) + 1
                if family in ('STOP_OTHER_UNIT', 'STOP2_OTHER_UNIT') and isinstance(row, dict) and any(int(k) > 2 for k in row if k.isdigit()):
                    extended_other.append({'state': state_name, 'field': key, 'raw': row})
    inventory.append({'profileId': profile.get('profileId'), 'path': str(path.relative_to(ROOT)).replace('\\', '/'),
                      'sha256': hashlib.sha256(blob).hexdigest(), 'counts': counts,
                      'otherTuplesWithFieldsBeyond2': extended_other})
report['currentRawProfileStopInventory'] = {
    'scope': 'raw state declarations in current twelve profession profile files, not every possible runtime callback',
    'profiles': inventory,
    'conclusion': '197 STOP_OTHER_UNIT and 29 STOP_MY_UNIT declarations; zero STOP_ALL or STOP2 declarations; no OTHER tuple third field',
    'narrowPolicy': 'fix active STOP_OTHER spatial reception; leave unsupported STOP2 explicit rather than aliasing independent timer semantics'}
out = ROOT / 'contracts/source-distance-native-v45.json'
out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'output': str(out), 'nativeSpans': len(native_spans), 'fmodSpans': len(fmod_spans),
                  'clientMeasured': False}, ensure_ascii=False))
