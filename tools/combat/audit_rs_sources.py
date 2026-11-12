"""Save compact, independent RS expectations from original declarations.

This script never imports the simulator or reads the generated RS profile.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PIN='ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'
def build(cache,source,native_source=None):
    documents={name:json.loads((cache/(name+'-declarations.json')).read_text('utf8')) for name in ('elsword','damage','effect','skill','enum')}
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=PIN:raise ValueError('Pinned SwordMan source changed')
    raw=documents['elsword']['globals']
    commands=['ESSI_ERS_COMBO_ZZZ','ESSI_ERS_COMBO_ZZZZ','ESSI_ERS_XZ','ESSI_ERS_XZ_CHARGE','ESSI_ERS_XZZ',
        'ESSI_ERS_FULL_CHARGE_XZZ','ESSI_ERS_DASH_COMBO_XZ','ESSI_ERS_DASH_JUMP_XZ','ESSI_ERS_DASH_JUMP_XZZ',
        'ESSI_EMK_DASH_JUMP_ZX','ESSI_EMK_DASH_JUMP_ZXX']
    damage_names=['ELSWORD_RUNE_SLAYER_COMBO_XZ','ELSWORD_RUNE_SLAYER_COMBO_XZZ','ELSWORD_RUNE_SLAYER_COMBO_FULL_CHARGE_XZZ',
        'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ','ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ','ELSWORD_RUNE_SLAYER_DASH_ZZX','FIREBALL_SMALL_DOWN_ELSWORD']
    damage={name:{'mainEffectName':documents['damage']['globals'][name]['MAIN_EFFECT_NAME'],
        'raw':documents['damage']['globals'][name]['DAMAGE_DATA'],'sourcePc':documents['damage']['locations'][name]} for name in damage_names}
    methods=['ESSI_ERS_XZ_FrameMove','ESSI_ERS_XZZ_FrameMove','ESSI_ERS_DASH_JUMP_XZ_FrameMove',
        'ESSI_ERS_DASH_JUMP_XZZ_FrameMove','ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a_FrameMove',
        'ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a_FrameMove','ESSI_SI_A_ERS_CRITICAL_SWORD_FrameMove',
        'ESSI_SI_A_ERS_RUNE_OF_FIRE_FrameMove','ESSI_A_ESK_PHOENIX_TALON_FrameMove',
        'ESSI_SA_EMK_BIG_BURST_FrameMove','ESSI_SA_ERS_SPLASH_EXPLOSION_StateStart']
    fragments=[]
    for name in methods:
        marker=('::'+name+'()').encode();start=data.index(marker);first=data.rfind(b'\n',0,start)+1
        brace=data.index(b'{',start);end=brace+1;depth=1
        while depth:depth+=(data[end]==123)-(data[end]==125);end+=1
        fragments.append(dict(name=name,startLine=data[:first].count(b'\n')+1,endLine=data[:end].count(b'\n')+1,sha256=hashlib.sha256(data[first:end]).hexdigest()))
    support={}
    if native_source:
        for relative,ranges in {
            'X2Lib/X2DamageEffect.h':[[49,58],[522,531]],
            'X2Lib/X2DamageEffect.cpp':[[2866,2931],[6548,6555]],
            'X2Lib/X2DamageManager.cpp':[[3439,3476]],
            'X2Lib/X2GameUnit.cpp':[[11196,11222]],
            'KTDXLIB/KTDGXMeshPlayer.cpp':[[1796,1822],[2997,3005],[3672,3701]],
        }.items():
            content=(native_source/relative).read_bytes();lines=content.splitlines(keepends=True)
            support[relative]={'sha256':hashlib.sha256(content).hexdigest(),'fragments':[dict(startLine=a,endLine=b,sha256=hashlib.sha256(b''.join(lines[a-1:b])).hexdigest()) for a,b in ranges]}
    return dict(schemaVersion=1,evidenceClass='target2016-static+qualified-fixedV5-reference',originalClientMeasurements=0,
        reference=dict(commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',sha256=PIN,fragments=fragments),
        qualifiedSupportingSource=support,
        sources={name:d['source'] for name,d in documents.items()},
        commands={name:{'raw':raw[name],'sourcePc':documents['elsword']['locations'][name]} for name in commands},
        damage=damage,independentRuneExpectations={'xzMagic':2.17,'xzzMagic':2.82,'fullChargeMagic':.71,'fullChargeHitGap':.05,
            'airXzMagic':2.44,'airXzzMagic':3.12,'groundBirthTime':.3,'airBirthTime':.26,'releaseTime':.01,
            'xzMpReference':4,'dashFireballMpReference':6,'xzSpineOffset':170,'airBip01Offset':[160,-90,0]},
        independentSkillExpectations={'explosiveBirth':.65,'explosiveEnhancedHitGap':.05,'explosiveBaseHitGap':.07,
            'explosiveMeshLife':.5,'explosiveDefaultLockOnUnitUID':-1,'lunaBurnMaxMpFraction':.3,'hyperBurnMp':10,'hyperBurnCount':6,
            'lunaDirSpeedFade':{'start':.01,'end':.05,'value':-2000},'lunaDirSpeedLaunch':{'start':.2,'value':5500},
            'brutalText':{'source':'target2016 General.ess','sourceSha256':'0941ef963dc8e9d2a97531a5351bd2cdfb724b4637c36de9a11e82ba0032c724','stringId':35585,'text':'Targets cannot use mana break.'}},
        limitations=['Reference MP/time callbacks are pinned V5 consumers, not target2016 runtime traces.',
            'Target-only charge route consumes its own max-time/state/effect declarations; matching V6 consumer is unmeasured.',
            'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ_DIE references a missing original mesh definition; no replacement collision is fabricated.'])
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);p.add_argument('--source',type=Path,required=True)
    p.add_argument('--native-source',type=Path);p.add_argument('--output',type=Path,default=ROOT/'contracts/rs-combat-source-v1.json');a=p.parse_args()
    result=build(a.cache,a.source,a.native_source);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'commands':len(result['commands']),'damage':len(result['damage']),'consumers':len(result['reference']['fragments'])}))
