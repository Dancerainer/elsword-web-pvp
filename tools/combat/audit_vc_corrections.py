"""Record fixed source fragments behind the local VC correction, not a client trace."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.cache/native-source-runtime'
FRAGMENTS = {
    'KTDXLIB/KTDGXMeshPlayer.cpp': [(1584, 1823, 'mesh order, inverse gravity, land bounce, rotated DirSpeed'),
        (2062, 2153, 'old age lifetime and land crash'), (3281, 3377, 'literal mesh Velocity fade integration')],
    'X2Lib/X2DamageEffect.cpp': [(1854, 1886, 'saved live mesh position precedes die child'),
        (3861, 3930, 'mandatory RT_CREATE_DAMAGE_EFFECT / RT_CREATE_EFFECT_SET')],
    'X2Lib/X2GUUser.cpp': [(7932, 7953, 'effect contact returns before defender damage/reaction'),
        (12760, 12840, 'unit AttackResult additional effect creation')],
}
rows = []
for relative, fragments in FRAGMENTS.items():
    data = (SOURCE / relative).read_bytes()
    lines = data.splitlines(keepends=True)
    rows.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
        'fragments': [{'start': start, 'end': end, 'purpose': purpose,
            'sha256': hashlib.sha256(b''.join(lines[start-1:end])).hexdigest()} for start, end, purpose in fragments]})
out = {
    'schema': 1, 'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
    'targetClientMeasured': False,
    'evidenceClass': 'target2016 declarations + bounded fixed-V5 source consumers + current simulation regression',
    'sourceFiles': rows,
    'ravenCommandSource': 'vc-reference-consumers-v1.json',
    'enabledReferenceMacros': ['X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION',
        'X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION_VELOCITY_ACCUM_BUG_FIX', 'FIX_XMESH_PLAYER_GRAVITY_ERROR_TEST'],
    'regressions': ['single 668X returns to gravity after animation end',
        'two consecutive sampled-device 668ZXX / 668X / 668XX in both directions without resets',
        'mandatory impact child reduces actual HP without parent damage/critical/MP duplication',
        'rotated air projectile, parabolic grenade and midpoint mesh velocity fade',
        'Napalm and Ignition Crow ground children use actual Garpai collision',
        'combat and renderer sample the same mesh position and active animation'],
    'limits': ['No original 2016 client runtime trace acquired',
        'Reference source includes later maintenance; not proof of target executable identity',
        'Literal mesh interpreter remains explicitly bounded; unknown event types rejected',
        'Original D3DX controller transition and main-loop packet batching are not fully reproduced',
        'Original GetNearest_LUA fallback is still unavailable at the native geometry boundary'],
}
path = ROOT / 'contracts/vc-corrections-source-v2.json'
path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(path)
