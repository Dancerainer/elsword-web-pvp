"""Freeze original declarations and qualified reference consumers, not simulator output."""
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from run_camera_source import extract
sha=lambda data:hashlib.sha256(data).hexdigest()

def main():
    declarations={name:json.loads((ROOT/'.cache/is-target'/f'{name}-declarations.json').read_text('utf8')) for name in ('elsword','effect','damage')}
    states=('ESSI_COMBO_Z2','ESSI_ETK_COMBO_ZZZZ','ESSI_ETK_COMBO_ZZZZZ','ESSI_ETK_COMBO_XX',
        'ESSI_ETK_COMBO_XXX_LOOP','ESSI_ETK_COMBO_XXX_END','ESSI_ETK_COMBO_XXXZ','ESSI_ETK_DASH_COMBO_ZZ',
        'ESSI_EIS_DASH_COMBO_XX','ESSI_EIS_DASHJUMP_COMBO_XXX','ESSI_ETK_DASH_JUMP_ZZZ','ESSI_SI_SA_ETK_SWORD_FALL')
    sets=('EffectSet_SECOND_BLADE_COMBO','EffectSet_EIS_DASH_XX','EffectSet_ETK_DASH_JUMP_ZZZ',
        'Effectset_A_ETK_SWORD_SHIELD','Effectset_A_ETK_SWORD_SHIELD_ULTIMATE')
    damages=[name for name in declarations['damage']['globals'] if name.startswith(('ELSWORD_C_DASHXX_SWORD','ELSWORD_C_DASH_JUMP_ZZZ_SWORD'))]
    damages+=['DAMAGE_EFFECT_SWORD_SHIELD','DAMAGE_EFFECT_SWORD_SHIELD_ULTIMATE','ELSWORD_SWORDFALL_BLADE1']
    targets={name:{'source':d['source'],'evidenceClass':'static-2016-declaration'} for name,d in declarations.items()}
    targets['elsword']['states']={name:declarations['elsword']['globals'][name] for name in states}
    targets['effect']['sets']={name:next(c['args'][-1] for c in declarations['effect']['nativeCalls'] if isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')==name) for name in sets}
    targets['damage']['effects']={name:declarations['damage']['globals'][name] for name in damages}
    consumers=[]
    for file,expected,methods in (
        ('X2GUUser.cpp','ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
         ('void CX2GUUser::CommonStateEnd()', 'void CX2GUUser::CommonFrameMove_EffectSet( float')),
        ('X2DamageEffect.cpp','8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8',
         ('void CX2DamageEffect::CEffect::AttackResult()',))):
        data=(ROOT/'.cache/native-reference/X2Lib'/file).read_bytes()
        if sha(data)!=expected:raise ValueError('Pinned source mismatch: '+file)
        for signature in methods:
            block,start,end=extract(data,signature.encode('ascii'))
            consumers.append({'path':'X2Lib/'+file,'fileSha256':expected,'signature':signature,
                'line':data[:start].count(b'\n')+1,'lastLine':data[:end].count(b'\n')+1,'sha256':sha(block),
                'evidenceClass':'pinned fixedV5 reference; not target2016 native execution'})
    sword=(ROOT/'.cache/is-source/X2GUElsword_SwordMan.cpp').read_bytes()
    sword_sha='ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'
    if sha(sword)!=sword_sha:raise ValueError('Pinned SwordMan mismatch')
    for signature in ('void CX2GUElsword_SwordMan::ESSI_ETK_COMBO_XXX_LOOP_EventProcess()',
        'void CX2GUElsword_SwordMan::ESSI_A_ETK_SWORD_SHIELD_FrameMove()'):
        block,start,end=extract(sword,signature.encode('ascii'))
        consumers.append({'path':'X2Lib/X2GUElsword_SwordMan.cpp','fileSha256':sword_sha,'signature':signature,
            'line':sword[:start].count(b'\n')+1,'lastLine':sword[:end].count(b'\n')+1,'sha256':sha(block),
            'evidenceClass':'pinned fixedV5 reference; not target2016 native execution'})
    result={'schemaVersion':2,'clientMeasured':False,'sources':targets,'referenceConsumers':consumers,
        'referenceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','sourceDLL':'reports/is-feedback-d3dx-sources-v2.json',
        'userAdapters':{
            'cancelAnimationSeconds':{'Z2':{'skill':.24,'dash':.24,'walk':.24},'Z4':{'skill':.24,'dash':.34,'walk':.34},
                'Z5':{'skill':.44,'dash':.54,'walk':.54},'XX':{'skill':.5},'XXX_LOOP':{'dash':.44,'walk':.44},
                'XXX_END':{'skill':.3,'dash':.44,'walk':.44},'XXXZ':{'skill':.37,'dash':.37,'walk':.37,'recover':.4}},
            'earlyWalkInput':'fresh directional edge only; a held direction must not discard the queued follow-up attack',
            'animationEnd':'qualified IsAnimationEnd branch; no 10% grace before the .433 X loop routing',
            'dashXX':{'set':'EffectSet_EIS_DASH_XX','callAnimationTime':.28,'timingEvidence':'Web binding at target voice time; matching V6 callback unmeasured'},
            'dashJumpZZZ':{'set':'EffectSet_ETK_DASH_JUMP_ZZZ','callAnimationTime':0,'mpCost':10,'paymentEvidence':'explicit user requirement; gated before third-Z entry'},
            'swordFall':{'waves':1,'releaseAnimationTime':1,'blades':4,'reaction':'RT_BIG_DAMAGE','stopDef':.25,'backY':0,
                'spawnGeometry':'four original mesh Dummy01 paths; original -59 facing/+42 world-Y offsets',
                'excluded':'old cast/sheath/hover display, DIE/HIT/CREATE_DAMAGE_EFFECT descendants',
                'retained':'original blade helper geometry, source damage/850 knockback/hit particles'},
        },'limits':['No original2016-client input, collision, GPU or feel trace.',
            'DLL measurement proves the two unchanged model AnimationSet clocks/keys only.',
            'Original raw declarations, fixedV5 reference and explicit user Web adaptations remain separate.']}
    path=ROOT/'contracts/is-feedback-source-v2.json'
    path.write_bytes((json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
    print(sha(path.read_bytes()))
if __name__=='__main__':main()
