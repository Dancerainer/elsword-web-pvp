"""Add original minus glyph and red MP text to an owned, existing UI asset set."""
import argparse
import hashlib
import json
from pathlib import Path
from damage_numbers import Catalog, decode_glyph_rgba

ROOT = Path(__file__).resolve().parents[2]
RAW_SHA = '01ad0a9f40b650834ea2d2bafbef98e2e76286590b31d72a840f036a53c928ca'
CPP_SHA = '6996a32c7c7fa3c4feba22a6732f946cea38ddc080d45bb83d61cfb1c5a84c5d'
PERCENT_SHA = '3dc1efda0de2e0214e90234739c5ce947d9875bc95511c4c974ddcb5fa95eda8'
def sha(data): return hashlib.sha256(data).hexdigest()

def build(source_root, cpp, output):
    output = output.resolve()
    output.relative_to(ROOT)
    if output.is_symlink(): raise ValueError('Owned physical output required')
    catalog = Catalog(source_root)
    raw = catalog.path('PC_-.dds')
    data = raw.read_bytes()
    if sha(data) != RAW_SHA: raise ValueError('Original minus glyph differs')
    cpp_data = cpp.read_bytes()
    if sha(cpp_data) != CPP_SHA: raise ValueError('Pinned Buff consumer differs')
    manifest_path = output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8'))
    image = decode_glyph_rgba(data)
    image.save(output / 'PC_-.png')
    encoded = (output / 'PC_-.png').read_bytes()
    manifest['glyphs']['-'] = {'file':'PC_-.png','textureId':45,'width':image.width,'height':image.height,
        'format':'RGBA','rgbaSha256':sha(image.tobytes()),'source':catalog.evidence(raw),'sha256':sha(encoded),'bytes':len(encoded)}
    percent_raw = catalog.path('PC_%.dds')
    percent_data = percent_raw.read_bytes()
    if sha(percent_data) != PERCENT_SHA: raise ValueError('Original percent glyph differs')
    percent_image = decode_glyph_rgba(percent_data)
    percent_image.save(output/'PC_percent.png')
    percent_encoded=(output/'PC_percent.png').read_bytes()
    manifest['glyphs']['%']={'file':'PC_percent.png','textureId':37,'width':percent_image.width,'height':percent_image.height,
        'format':'RGBA','rgbaSha256':sha(percent_image.tobytes()),'source':catalog.evidence(percent_raw),'sha256':sha(percent_encoded),'bytes':len(percent_encoded)}
    manifest['styles']['red']['glyphs'] = '0123456789MP-%'
    manifest['mpLossSourceContract'] = 'contracts/rs-luna-source-v28.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', 'utf-8')
    profile = json.loads((ROOT/'packages/combat-core/rs-profile.json').read_text('utf-8'))
    before = json.loads((ROOT/'contracts/rs-feedback-source-v2.json').read_text('utf-8'))
    contract = {'schema':'elsword.rs-luna.v28','originalClientMeasurements':0,
        'evidenceClass':'target2016-static + pinnedV5-consumer + Web-adapter',
        'referenceCommit':before['reference']['commit'],'targetSources':before['staticSources'],
        'targetSkillSource':profile['sources']['skill'],
        'buffConsumer':{'path':'JP_TW_EU_CN_US/Trunk/X2Lib/X2BuffBehaviorTemplet.cpp','sha256':CPP_SHA,
            'gitBlob':'5237c18c633c95e70145c520a67ce47786504cdd','lines':[670,714]},
        'swordConsumer':before['reference']['swordMan'],
        'damageStages':{name:profile['damageEffects'][name] for name in
            ['DamageEffect_SA_ERS_LunaBlade','DamageEffect_SA_ERS_LunaBlade_ExposionFinal']},
        'factor117':profile['buffFactors']['117'],'template98':profile['buffTemplates']['98'],
        'minusGlyph':manifest['glyphs']['-'],
        'percentGlyph':manifest['glyphs']['%'],
        'healthConsumer':{'reference':'fixedV5',
            'damageEffectSha256':sha((ROOT/'.cache/native-source-runtime/X2Lib/X2DamageEffect.cpp').read_bytes()),
            'damageManagerSha256':sha((ROOT/'.cache/native-source-runtime/X2Lib/X2DamageManager.cpp').read_bytes()),
            'lines':{'createDie':[6025,6100],'perInstanceHitMemory':[2330,2347],'rejection':[970,982]},
            'findings':['Die children CreateInstance independently; inherited BuffFactor only when requested; no inherited hitUnitList in this path',
                'No NO_DAMAGE or shared DAMAGE_EFFECT_GROUP_DAMAGE declaration in the two target rows',
                'Model trajectory may miss the upper platform and explode on a lower plane; this is original map collision, not a fixed cast-centered radius']},
        'policy':{'healthDamage':'Keep both declared17.84 multipliers; no NO_DAMAGE field or inherited hitUnitList found',
            'mpBurn':'Each accepted blade/explosion stage burns30% max MP; stage receipt rejects repeated/older reports',
            'referenceRedText':'PinnedV5 uses MP signed integer delta, red PicChar26-unit advance, target HeadY-50; target2016 consumer unavailable',
            'userRedText':'Project rule requires red MP -30% for Luna98; original glyph37, same red particle and anchor; actual MP arithmetic unchanged',
            'explosionGeometry':'Original DummyAttackBox_50x50x50, Size12/12/12; helper sphere adapter is not original bounding-sphere proof',
            'targetConsumerUnavailable':True}}
    (ROOT/'contracts/rs-luna-source-v28.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2)+'\n','utf-8')
    return {'glyphSha256':sha(encoded),'manifestSha256':sha(manifest_path.read_bytes())}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--cpp',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/ui/damage-numbers')
    args=parser.parse_args()
    print(json.dumps(build(args.source_root,args.cpp,args.output)))
