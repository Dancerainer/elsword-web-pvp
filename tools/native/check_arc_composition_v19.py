"""Verify every skills include and expanded adapter against pinned source bytes."""
from pathlib import Path
import hashlib,json
import build_skill_callbacks as builder

def sha(data):return hashlib.sha256(data).hexdigest()

def check(root,output=None):
    root=Path(root);output=Path(output) if output else root/'.cache/native-archenemy-skills-v19'
    contract=json.loads((output/'source-contract.json').read_text('utf8'))
    cache=root/'.cache/native-source-runtime'
    source=(cache/'X2Lib/X2GURaven.cpp').read_bytes()
    primary,records=builder.extract(source)
    if contract['functions']!=records:raise ValueError('Primary skills source metadata drift')
    expected={'original_skill_methods.inc':primary}
    def fragment(row):
        path=root/'.cache/reference-combat-fixes-v11/X2GURaven.cpp' if row.get('sourceCommit')==builder.REPAIRED_COMMIT else cache/row['file']
        raw=path.read_bytes()
        if 'sourceFileSha256' in row and sha(raw)!=row['sourceFileSha256']:raise ValueError('Include source file drift')
        selected=b''.join(raw.splitlines(keepends=True)[row['startLine']-1:row['endLine']])
        count=row['bytes']
        for i in range(len(selected)-count+1):
            data=selected[i:i+count]
            if sha(data)==row['sha256']:return data
        raise ValueError('Original include fragment drift')
    extra=contract['extraFunctions']
    if [row['name'] for row in extra]!=builder.EXTRA_FUNCTIONS+['CX2DamageEffect::CEffect::VectorLockOn']:
        raise ValueError('Extra include method inventory drift')
    expected['original_extra_skill_methods.inc']=b'\n\n'.join(fragment(row) for row in extra[:-1])+b'\n'
    expected['original_vector_lockon.inc']=fragment(extra[-1])+b'\n'
    header=(cache/contract['macros']['file']).read_bytes()
    if sha(header)!=contract['macros']['sourceFileSha256']:raise ValueError('Original skills macro source drift')
    expected['original_skill_macros.inc']=b'\n'.join(b''.join(header.splitlines(keepends=True)[lo-1:hi]) for lo,hi in contract['macros']['lines'])
    if sha(expected['original_skill_macros.inc'])!=contract['macros']['sha256']:raise ValueError('Original skills macro closure drift')
    for row,name in zip(contract['arcSourceFragments'],['original_arc_follow.inc','original_arc_cooldown.inc','original_arc_lifecycle.inc'],strict=True):
        raw=(cache/row['file']).read_bytes()
        data=b''.join(raw.splitlines(keepends=True)[row['startLine']-1:row['endLine']])
        if sha(raw)!=row['sourceFileSha256'] or sha(data)!=row['sha256']:raise ValueError('Original Arc source closure drift')
        expected[name]=data
    for row,name in zip(contract['animationFunctions'],['original_skill_timer_inline.inc','original_skill_timer_out.inc'],strict=True):
        raw=(cache/row['file']).read_bytes()
        data=b''.join(raw.splitlines(keepends=True)[row['startLine']-1:row['endLine']])
        if sha(raw)!=row['sourceFileSha256'] or sha(data)!=row['sha256']:raise ValueError('Original timer source closure drift')
        expected[name]=data
    actual={p.name for p in output.glob('*.inc')}
    if actual!=set(expected) or len(actual)!=9:raise ValueError('Skills include inventory drift')
    for name,data in expected.items():
        if (output/name).read_bytes()!=data:raise ValueError('Compiled original include drift: '+name)
    adapter=(root/'tools/native/skill_source_adapter.cpp').read_bytes()
    if sha(adapter)!=contract['adapterSha256']:raise ValueError('Skills adapter template drift')
    cpp=adapter.replace(b'// @@METHOD_DECLARATIONS@@',b'\n'.join(('void '+name+'();').encode() for name in builder.FUNCTIONS[6:]+builder.SHADOW_FUNCTIONS[:-2]+builder.DRILL_FUNCTIONS+builder.MOTION_FUNCTIONS+builder.XCRASH_FUNCTIONS+builder.ARC_HYPER_FUNCTIONS))
    cpp=cpp.replace(b'// @@METHOD_DISPATCH@@',b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(builder.FUNCTIONS[6:],5))+b'\nif(kind==69)r.SI_SA_RRF_X_CRASH_FrameMove();\nif(kind==70)r.RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove();')
    cpp=cpp.replace(b'// @@SHADOW_DISPATCH@@',b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(builder.SHADOW_FUNCTIONS[:-2],28))+b'\nif(kind==54)r.SetShadowStepAttackSkill(shadowSnapshot[25].i);\nif(kind==55)r.InitShadowStep();')
    cpp=cpp.replace(b'// @@DRILL_DISPATCH@@',b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(builder.DRILL_FUNCTIONS+builder.MOTION_FUNCTIONS,56)))
    cpp=cpp.replace(b'// @@EXTRA_DECLARATIONS@@',b'\n'.join(('void '+name+'();').encode() for name in builder.EXTRA_FUNCTIONS))
    cpp=cpp.replace(b'// @@EXTRA_DISPATCH@@',b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(builder.EXTRA_FUNCTIONS,61))+b'\nif(kind==67)r.RSI_SA_RRF_WILD_CHARGING_EventProcess();\nif(kind==68)r.RSI_SA_RRF_WILD_CHARGING_FrameMove();')
    if (output/'skills.generated.cpp').read_bytes()!=cpp:raise ValueError('Compiled skills adapter composition drift')
    return {'includes':len(expected),'originalMethods':len(records)+len(extra),'expandedCppSha256':sha(cpp)}
