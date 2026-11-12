"""Freeze exact LOT6 source evidence without running or modifying the client."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
def sha(data):return hashlib.sha256(data).hexdigest()
def build(cache):
    profile=json.loads((ROOT/'packages/combat-core/bh-profile.json').read_text('utf8'))
    sections={
        'X2Lib/X2DamageEffect.h':[(49,64,'LOCK_ON_TYPE enum: LOT_NEARST_UID_VECTOR_IN_RANGE is 6')],
        'X2Lib/X2DamageEffect.cpp':[(2780,2807,'Delayed unlock before LOT steering'),
            (3092,3299,'LOT6 collision point, hit edge retarget, death retarget and missing target acquisition'),
            (6531,6545,'PvP range pair overrides constructor defaults; reconstructed reference helper'),
            (6625,6652,'Y_DIR_INIT/owner range loading only; no matching consumer'),
            (6712,6803,'Existing compiled VectorLockOn algorithm'),
            (4562,4565,'Accepted attack increments the effect hit counter')],
        'X2Lib/X2Game.cpp':[(11993,12091,'Strict nearest enemy selection and game-global previous-target exclusion lifecycle')],
        'KTDXLIB/KTDGXMeshPlayer.cpp':[(1275,1280,'Manual direction initialized from original mesh angle'),
            (1795,1832,'Nonmanual and manual directional movement; no implicit normalization of curved movement')],
    }
    sources={}
    for name,rows in sections.items():
        data=(cache/name).read_bytes();lines=data.splitlines(keepends=True)
        sources[name]={'sha256':sha(data),'bytes':len(data),'sections':[
            {'firstLine':first,'lastLine':last,'sha256':sha(b''.join(lines[first-1:last])),'meaning':meaning} for first,last,meaning in rows]}
    name='DamageEffect_SBH_Blaze_Wing_Sub';template='Mesh_Elesis_SBH_Blaze_Wing_Sub_Projectile'
    result={'schemaVersion':1,'id':'bh-blaze-wing-lock-on-v1','clientMeasured':False,
        'sourceClass':'original target2016 declarations + bounded fixed-V5 reference adapter',
        'skillId':28017,'damageName':name,'damageDeclaration':profile['damageEffects'][name],
        'templateDeclaration':profile['effectTemplates'][template],'fixedSources':sources,
        'consumers':{'movement':'KTDGXMeshPlayer directional packet before DamageEffect steering',
            'curve':'Existing nativeSkills.vectorLockOn WASM; no new JS steering approximation',
            'targetRange':'Use original PVP_TARGET_RANGE_MIN_MAX {0,700}; strict endpoints, no source default substitution',
            'history':'X2Game-global exclusion set. Add selected UID; clear only when exclusion-enabled search finds no eligible candidate. No per-cast or per-effect reset.',
            'network':'Per-effect historySnapshot and selectionSerial expose decisions. Receiver ownership ordering is a separately validated host policy.'},
        'unsupportedOriginalFields':['LOCK_ON_DATA.Y_DIR_INIT','LOCK_ON_DATA.LOCK_ON_RANGE_FROM_OWNER'],
        'limits':['Pinned reference contains reconstructed range-loader code; target client trajectory unmeasured.',
            'No NPC actor model is added; original NPC trap/checker/raid filters remain outside this PvP user-unit consumer.',
            'Global history replication uses the project owner protocol, not the original native protocol.']}
    path=ROOT/'contracts/bh-blaze-wing-lock-on-source-v1.json'
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8',newline='\n')
    print(json.dumps({'contract':str(path.relative_to(ROOT)),'sha256':sha(path.read_bytes())}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reference-cache',type=Path,default=ROOT/'.cache/native-reference')
    build(p.parse_args().reference_cache)
