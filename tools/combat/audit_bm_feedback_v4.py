"""Freeze reparsed target2016 BM feedback declarations and pinned V5 references."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/native'))
from run_camera_source import extract

def read(path): return json.loads(path.read_text('utf8'))

def audit(reference):
    raw = reference.read_bytes()
    expected = 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Pinned fixed-V5 Raven changed')
    documents = {name: read(ROOT/f'.cache/bm/{name}-declarations.json') for name in ('raven', 'effect', 'damage')}
    for document in documents.values():
        path = Path(document['source']['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != document['source']['sha256']:
            raise ValueError('Target2016 declaration input changed: '+str(path))
    names = ['RBM_COMBO_ZZZX', 'RBM_COMBO_ZZZXZ', 'RSI_COMBO_XXX',
        'RSI_SI3_SOUL_TAKER_HYPERSONIC_STAB', 'RSI_SI3_SOUL_TAKER_HYPERSONIC_STAB_HYPER']
    damage = ['RBM_BLACKHOLE', 'RAVEN_HYPER_SONIC_STAB', 'RAVEN_HYPER_SONIC_STAB_Damage',
        'RAVEN_HYPER_SONIC_STAB_HYPER', 'RAVEN_HYPER_SONIC_STAB_HYPER_Damage', 'DamageEffect_RF_XXX']
    sets = ['EffectSet_RBM_BLACKHOLE', 'EffectSet_A_RF_XXX']
    methods = ['RBM_COMBO_ZZZX_StateStart', 'RBM_COMBO_ZZZX_FrameMove', 'RBM_COMBO_ZZZX_EventProcess',
        'RBM_COMBO_ZZZXZ_Start', 'RBM_COMBO_ZZZXZ_EventProcess',
        'RBM_COMBO_ZZZX_EXPLOSION_StateStart', 'RBM_COMBO_ZZZX_EXPLOSION_FrameMove',
        'RSI_WAIT_Start', 'RSI_WALK_Start', 'RSI_DASH_END_Start', 'DamageReact',
        'RSI_SI3_SOUL_TAKER_HYPERSONIC_STAB_FrameMoveFuture',
        'RSI_SI3_SOUL_TAKER_HYPERSONIC_STAB_FrameMove', 'RSI_COMBO_XXX_FrameMove']
    spans = []
    for name in methods:
        block, first, last = extract(raw, ('void CX2GURaven::'+name+'(').encode())
        spans.append({'method': name, 'firstLine': first, 'lastLine': last,
            'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
    block, first, last = extract(raw, b'bool CX2GURaven::SpecialAttackEventProcess(')
    spans.append({'method': 'SpecialAttackEventProcess', 'firstLine': first, 'lastLine': last,
        'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
    set_raw = reference.with_name('X2EffectSet.cpp').read_bytes()
    set_sha = '395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440'
    if hashlib.sha256(set_raw).hexdigest() != set_sha:
        raise ValueError('Pinned fixed-V5 EffectSet changed')
    stop_spans = []
    for signature in (b'void CX2EffectSet::StopEffectSet(',
            b'CX2EffectSet::EffectSetInstance::~EffectSetInstance(',
            b'CX2EffectSet::EffectInstance::~EffectInstance('):
        block, first, last = extract(set_raw, signature)
        stop_spans.append({'signature': signature.decode(), 'firstLine': first, 'lastLine': last,
            'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
    target_sets = {row['args'][-1]['NAME']: {'raw': row['args'][-1],
        'sourcePc': {'prototype': row['prototype'], 'instruction': row['instruction']}}
        for row in documents['effect']['nativeCalls'] if isinstance(row['args'][-1], dict) and row['args'][-1].get('NAME') in sets}
    result = {'schemaVersion': 1, 'targetVersion': 'Steam-NA-2016-V6.0420.5',
        'targetClientMeasured': False, 'originalClientMeasurementCount': 0,
        'targetNativeConsumerAvailable': False,
        'targetSources': {key: doc['source'] for key, doc in documents.items()},
        'targetStates': {name: {'raw': documents['raven']['globals'][name],
            'sourcePc': documents['raven']['locations'][name]} for name in names},
        'targetSets': target_sets,
        'targetDamageEffects': {name: {'raw': documents['damage']['globals'][name],
            'sourcePc': documents['damage']['locations'][name]} for name in damage},
        'referenceSource': {'path': 'X2Lib/X2GURaven.cpp', 'sha256': expected,
            'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
            'evidenceClass': 'fixed-V5-version-reference-not-target2016', 'spans': spans},
        'stopSetReference': {'path': 'X2Lib/X2EffectSet.cpp', 'sha256': set_sha,
            'gitBlob': hashlib.sha1(b'blob '+str(len(set_raw)).encode()+b'\0'+set_raw).hexdigest(),
            'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
            'evidenceClass': 'fixed-V5-version-reference-not-target2016', 'spans': stop_spans,
            'stopPolicy': 'StopEffectSet deletes the saved instance; its destructor deletes every effect member, including the damage handle and particle handles.'},
        'blackHoleTimerReference': {'firstLine': 5485, 'lastLine': 5509,
            'clock': 'm_fElapsedTime; no animation speed multiplier',
            'stopCondition': 'remaining <= 0 or owner death; explicit StopEffectSet handle',
            'cancelCallbacks': {
                'successfulSpecialAttack': [5975, 5982],
                'waitStart': [6116, 6123], 'walkStart': [6180, 6187], 'dashEndStart': [6490, 6497],
                'loseFloorZZZX': [16134, 16139], 'loseFloorZZZXZ': [16177, 16183],
                'nonDummyDamageReaction': [455, 472]},
            'cancelPolicy': 'BALANCE_BLADE_MASTER_20130117 clears the timer/count after successful skill acceptance or the listed movement callbacks; failed skills and internal ZZZXZ continuations do not clear it.',
            'recheck': 'V5 recheck supersedes the earlier incomplete v4 lifetime conclusion.'},
        'xxxReuse': {'authorization': 'Project rule reuses the RF XXX implementation for BM.',
            'adapterContract': 'contracts/rf-xxx-candidate-v15.json',
            'targetNativeOwnerVerified': False, 'mpGate': 'Existing compiled fixed-V5 .16 / 7 MP gate; target2016 equivalence pending.',
            'unchanged': ['Original .25 set delay', 'Original .4 mesh lifetime', 'Original damage and helpers',
                'Original accepted-hit ceiling', 'Existing cancellation and payment failure policy']},
        'conclusions': {'blackHoleSkillGate': 'Target .033 / .209 strict gates are already implemented; preserve.',
            'blackHoleSkillCancelLifetime': 'Pinned fixed V5 explicitly clears the retained timer on successful SpecialAttack; its next FrameMove stops the saved set. Preserve no-DELETE_STATE declarations but consume these cancellation callbacks.',
            'ordinaryHypersonicStab': 'Preserve target .6-.94 contact and child .5-.65 global damage windows; no source supports an arbitrary delay.',
            'hypersonicDynamicFeel': 'Target2016 original-client trajectory unavailable; player timing suspicion remains a dynamic verification boundary.'}}
    path = ROOT/'contracts/bm-feedback-source-v4.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', 'utf8')
    print(json.dumps({'targetStates': len(names), 'targetDamageEffects': len(damage), 'referenceMethods': len(spans)}))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--reference', type=Path, required=True)
    audit(p.parse_args().reference)
