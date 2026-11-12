"""Seal target declarations and qualified fixed-V5 feedback consumers.

The original client is not executed. This receipt is independent of combat
simulation outputs and never treats a current adapter run as a native answer.
"""
import argparse, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SHA=lambda data:hashlib.sha256(data).hexdigest()
COMMIT='a8438f3ed18dd6f0944793de6c0d8bb9334e9633'

def build(sword_source,native_source):
    sword=Path(sword_source).read_bytes()
    if SHA(sword)!='ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d':
        raise ValueError('Pinned SwordMan consumer changed')
    effect=(Path(native_source)/'X2Lib/X2EffectSet.cpp').read_bytes()
    if SHA(effect)!='395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440':
        raise ValueError('Pinned EffectSet consumer changed')
    references=[]
    for path,data,first,last,method in [
        ('X2Lib/X2EffectSet.cpp',effect,828,872,'damage target mesh binding'),
        ('X2Lib/X2EffectSet.cpp',effect,904,940,'visual target mesh binding'),
        ('X2Lib/X2EffectSet.cpp',effect,3825,3869,'GetEffectPositionByTargetMesh'),
        ('X2Lib/X2GUElsword_SwordMan.cpp',sword,8589,8670,'DashAttackXEventProcess'),
        ('X2Lib/X2GUElsword_SwordMan.cpp',sword,10193,10272,'Unlimited Blade six normal swings'),
        ('X2Lib/X2GUElsword_SwordMan.cpp',sword,10534,10618,'Unlimited Blade six awakened swings'),
        ('X2Lib/X2GUElsword_SwordMan.cpp',sword,12519,12586,'Armageddon Blade cast particles'),
        ('X2Lib/X2GUElsword_SwordMan.cpp',sword,15153,15194,'Rolling Smash flight and landing')]:
        fragment=b'\n'.join(data.split(b'\n')[first-1:last])+b'\n'
        references.append({'path':path,'fileSha256':SHA(data),'fragmentSha256':SHA(fragment),
            'startLine':first,'endLine':last,'method':method,'commit':COMMIT,'evidenceClass':'fixedV5-version-reference'})
    sources=[];declarations={}
    for filename in ['elsword-declarations.json','effect-declarations.json']:
        doc=json.loads((ROOT/'.cache/lk'/filename).read_text(encoding='utf8'))
        if SHA(Path(doc['source']['path']).read_bytes())!=doc['source']['sha256']:
            raise ValueError('Target2016 original declaration changed')
        sources.append(doc['source']);declarations[filename]=doc
    states=declarations['elsword-declarations.json']['globals']
    sets={c['args'][1]['NAME']:c['args'][1] for c in declarations['effect-declarations.json']['nativeCalls']
        if c['target']=='g_pEffectSet.AddEffectSetTemplet_LUA' and len(c['args'])==2 and isinstance(c['args'][1],dict) and 'NAME' in c['args'][1]}
    names=['EffectSet_SA_ELK_ArmagedonBlade','EffectSet_SA_Elsword_SandStorm','EffectSet_ESK_DASH_JUMP_ZZZ','EffectSet_A_Elsword_RollingSmash']
    windows=[[states['ESSI_SI3_ES_UNLIMITED_BLADE']['ATTACK_TIME'+str(i)][k] for k in ['1','2']]for i in range(6)]
    if windows!=[[.166,.233],[.433,.5],[.666,.733],[.966,1.033],[1.3,1.366],[1.5,1.566]]:
        raise ValueError('Target six attack windows changed')
    result={'schemaVersion':1,'evidenceClass':'target2016 static declarations + qualified fixedV5 consumer reference',
        'originalClientMeasured':False,'sources':sources,'references':references,
        'effectSets':{name:sets[name]for name in names},
        'dashX':{'targetSourceState':'ESSI_DASH_ATTACK_X','targetEventWindow0':states['ESSI_DASH_ATTACK_X']['EVENT_PROCESS_TIME0'],
            'targetEventWindow1':states['ESSI_DASH_ATTACK_X']['EVENT_PROCESS_TIME1'],
            'binding':'held-key skip after target window1[3], strict float comparison; preserve X-chain precedence',
            'versionConflict':'fixedV5 hardcodes .6; target2016 declaration is .666; target-client runtime not measured'},
        'unlimitedBlade':{'targetAttackWindows':windows,'normalAndAwakened':True,'hitUnitListResetPerSwing':True,
            'reactTypeChange':{'fromSwing':4,'type':2},
            'versionConflict':'fixedV5 normal sixth reset 1.566 is outside target 1.5..1.566 window; target window start is used'},
        'armageddonCast':{'lights':{'animationTime':.9,'bone':'Dummy1_Rhand','trace':False,
            'names':['Light_Knight_ArmageddonBlade01','Light_Knight_ArmageddonBlade02']},
            'flare':{'animationTime':1.7,'bone':'Dummy1_Rhand','forwardOffset':305,'worldYOffset':70,
                'name':'Flare_MagicKnight_WindBlade01'},'buffAnimationTime':1.68},
        'limits':['No original-client input trajectory or GPU comparison',
            'Skill medium particle divisor is an authorized web display budget, not a claimed original medium density',
            'Preserve source emission clocks for short sword mesh/trail layers; retain ambient particle density budget',
            'Owner IDs are remapped per cast; historical/live attack receipts include the six distinct target swings']}
    target=ROOT/'contracts/lk-fx-combat-feedback-source-v3.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--sword-source',type=Path,required=True);p.add_argument('--native-source',type=Path,required=True)
    a=p.parse_args();r=build(a.sword_source,a.native_source);print(json.dumps({'effectSets':len(r['effectSets']),'references':len(r['references']),'originalClientMeasured':False}))
