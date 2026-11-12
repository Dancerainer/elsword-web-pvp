"""Freeze source evidence for VC aura, acceptance notice and overheat arm.

This records target resource bytes / fixed-version consumers, never a client
run or a visual-fidelity claim derived from the current implementation.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'.cache/native-source-runtime'
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_text('utf8'))
FRAGMENTS = {
    'X2Lib/X2GURaven.cpp': [
        (5509, 5529, 'Overheat duration expires and closes the arm'),
        (5571, 5610, 'Per-frame Forearm matrix and Forearm/Hand fire position'),
        (17376, 17445, 'Original overheat notice / overlap stage resources and head offsets'),
        (18681, 18705, 'Revolver accepted input notice'),
        (18799, 18830, 'Harpoon accepted input notice'),
        (19057, 19082, 'Gatling accepted input notice'),
        (19382, 19391, 'Giga overheat finish entry notice'),
        (20618, 20668, 'Deadly Raid notices 1/2/3 at original input thresholds'),
        (20710, 20738, 'Ignition Crow accepted input notice'),
        (23048, 23076, 'Incineration accepted input notice'),
        (21603, 21704, 'Arm open/close mesh and two fire effect owners'),
        (21804, 21836, 'Shared Raven awakening starts four minor sequences'),
    ],
    'X2Lib/X2GUUser.cpp': [(13145, 13160, 'GetHeadBonePos source frame plus world Y70')],
    'X2Lib/X2GameUnit.cpp': [(12783, 12965, 'Shared aura deletion, bones and remaining-time emission rate')],
    'KTDXLIB/KTDGXMeshPlayer.h': [(831, 866, 'Absent PlayCount defaults zero; mesh blend and depth defaults')],
    'KTDXLIB/KTDGXMeshPlayer.cpp': [(2104, 2128, 'Skin end increments then equality-compares original play count')],
    'KTDXLIB/KTDGXSkinAnim.cpp': [(756, 824, 'XAP_ONE/WAIT preserve end flag in STOP/WAIT; LOOP restarts')],
    'KTDXLIB/KTDGXSkinAnim.h': [(269, 312, 'Confirmed missing clone frame returns literal world zero, not actor or mesh origin')],
    'X2Lib/X2DamageManager.h': [(1300, 1306, 'DamageData initializes impactPoint to literal world zero')],
    'X2Lib/X2DamageEffect.cpp': [
        (2356, 2434, 'DamageCheck precedes first-frame START particles; impact point comes from that check'),
        (5463, 5488, 'Particle creation copies the actual damage-effect land plane before SetParticleData'),
        (6163, 6200, 'DEPT_BONE uses GetCloneFramePosition with the source bone name'),
        (6306, 6327, 'DEPT_IMPACT_POINT uses retained DamageData impactPoint, no invented mesh birth origin'),
    ],
    'X2Lib/X2EffectSet.cpp': [
        (1298, 1316, 'TRACE update gets position, then breaks before SetPosition if target mesh became invalid'),
        (2778, 2804, 'Target-mesh position precedes explicit/custom or owner routes'),
        (3779, 3873, 'Target handle mesh lookup and named target bone; dead target invalidates the handle'),
    ],
}


def build():
    raven_source = read(ROOT/'contracts/vc-reference-consumers-v1.json')['source']
    if sha((SOURCE/'X2Lib/X2GURaven.cpp').read_bytes()) != raven_source['sha256']:
        raise ValueError('Fixed Raven source identity changed')
    files = []
    for path, fragments in FRAGMENTS.items():
        data = (SOURCE/path).read_bytes()
        lines = data.splitlines(keepends=True)
        files.append({'path': path, 'bytes': len(data), 'sha256': sha(data),
            'fragments': [{'line': a, 'lastLine': b, 'purpose': purpose,
                           'sha256': sha(b''.join(lines[a-1:b]))} for a, b, purpose in fragments]})
    fx = read(ROOT/'artifacts/vc/fx/index.json')
    names = ['HyperBoostRightBlack', 'HyperBoostLeftBlack', 'WeaponTaker_Overheat',
             *[f'Overlap_EDT_Emoticon_{i}_OverHeat' for i in range(1, 4)],
             'RVC_OverHeat_Object_Start', 'RVC_OverHeat_Object_End',
             'RVC_OverHeat_Main_Effect', 'RVC_buff_OverHit_P01', 'RVC_buff_OverHit_P02']
    names += ['RWT_BARRAGE_ATTACK_TRACE_Stand', 'B_RWT_GIGA_PROMINENCE_pillar_fire_B']
    names += ['RVC_NAPALM_BOMB_EXPLOSION_ATTACKBOX', 'RVC_C_dashJumpX_hitGround_P05_1',
              *[f'raven_SA_hellFire_hit_0{i}' for i in range(1, 6)], 'EffectSet_RVC_Flame_Buster_P05',
              'SA_RVC_IGNITION_CROW_INCINERATION_M01', 'SA_RVC_IGNITION_CROW_INCINERATION_OVERHEAT_M01',
              'SA_RVC_IGNITION_CROW_INCINERATION_P01', 'SA_RVC_IGNITION_CROW_INCINERATION_P02']
    templates = []
    for name in names:
        t = fx['templates'][name]
        templates.append({key: t[key] for key in ('name', 'kind', 'source', 'declarationSha256',
            'glb', 'poseData', 'animationClips', 'sharedResourceEvidence') if key in t})
    dll = read(ROOT/'reports/vc-fx-d3dx-sources-v1.json')
    arm = next(row for row in dll['sources'] if Path(row['source']).name.lower() == 'mesh_raven_rvc_cash_left_hand_effect.x')
    return {'schemaVersion': 1, 'referenceCommit': raven_source['commit'], 'targetClientMeasured': False,
        'evidenceClass': 'target2016 original resource declarations; fixedV5 source consumers; original D3DX DLL key/period measurement',
        'sourceFiles': files, 'templates': templates, 'armNativeMeasurement': arm,
        'bindings': {
            'awakening': 'Four shared Raven minor emitters, RF and VC each routed by profession; bones exchange on facing change',
            'notice': 'Accepted overheat input emits the original 0.5-second WeaponTaker_Overheat once; Deadly Raid adds original stage1/2/3',
            'noticePosition': 'GetHeadBonePos + lineDirection * (isRight ? 140 : -140), world Y+60; overlap adds unmirrored lineDirection*50 and world Y+20',
            'arm': 'RVC_OverHeat_Object_Start/End use complete Bip01_L_Forearm combineMatrix, not only XYZ/yaw',
            'fire': 'Two DAMAGE_EFFECT_OVERHEAT_EFFECT owners follow Bip01_L_Forearm and Bip01_L_Hand positions',
            'meshPlayCount': 'Absent count keeps original zero; count3 plus XAP_ONE consumes sticky end on three packets without replaying animation',
            'gatlingImpactParticles': 'First live damage check precedes START particles; POSITION_TYPE2 reads retained impactPoint, with literal zero only for no hit yet',
            'missingDamageMeshBone': 'Original BREAKING_FIST_Attack_Box has no Dummy01; this DEPT_BONE call returns source GetCloneFramePosition world zero, then OFFSET_Y10; no invented attachment',
            'flameBusterLandPlane': 'START particle EffectSet_RVC_Flame_Buster_P05 inherits current damage-effect landY before UseLand applies its original bounce/clamp',
            'incinerationTarget': 'Two source sets designate EFFECT0 damage mesh via BONE_TRACE_TARGET_MESH; eight TRACE children sample its original Dummy01/02/03/bip02_Bone03 and freeze last position after target deletion because update breaks before SetPosition',
        },
        'platformOptimizations': [{'name': 'terminal-transparent-zero-count-visual',
            'template': 'RWT_BARRAGE_ATTACK_TRACE_Stand', 'lastVisibleTime': 0.4,
            'proof': 'Permanent global alpha0, source-alpha blend, opaque destination, no depth writes, no child/unknown events; renderer mesh only',
            'behavior': 'Release invisible render instance and owner bookkeeping; leave authored PlayCount/animation declarations unchanged',
            'originalStopConsumer': 'No finite original stop established; this is output-equivalent web optimization, not a claimed native lifetime'}],
        'resourceReuse': {'newTextureFiles': 0, 'newMeshFiles': 0,
            'aura': 'Two source declarations reference existing RF awakening-fx/Energy PNG; all overheat resources already shipped in VC'},
        'limits': ['No target2016 client runtime/GPU side-by-side capture',
            'Fixed V5 source is version reference, not proof of target executable identity',
            'Browser event de-duplication and per-owner handles are platform adapters',
            'Other skill visuals and actor animation transitions are separately audited'],
    }


if __name__ == '__main__':
    path = ROOT/'contracts/vc-presentation-source-v3.json'
    path.write_text(json.dumps(build(), ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(path)
