"""Hash actual fixed-source reflection consumers without importing the simulator."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def sha(data): return hashlib.sha256(data).hexdigest()


def main():
    prior = json.loads((ROOT/'contracts/rf-archenemy-trigger-source-v8.json').read_text('utf8'))
    known = {r['relativePath']: r for r in prior['sources']} if 'sources' in prior else None
    if known is None:
        rows = next(v for v in prior.values() if isinstance(v, list) and v and isinstance(v[0], dict) and 'relativePath' in v[0])
        known = {r['relativePath']: r for r in rows}
    spans = {
        'X2Lib/X2DamageEffect.cpp': [(1220, 1234, 'effect constructor initializes reflection count to 2'),
            (1310, 1320, 'constructor default REFLECT=false'), (1509, 1517, 'original REFLECT loader default false'),
            (3761, 3860, 'RT_REVENGE/RT_REFLECT successor instance creation, count and transform'),
            (3778, 3796, 'reaction particles require positive count; emitted before REFLECT recreation gate'),
            (3798, 3802, 'world black flash and one-second fade to origin color, independent of reflection count')],
        'X2Lib/X2GUUser.cpp': [(8176, 8280, 'strict front-facing state window, separate RS probability, CAN_REFLEX reaction gate and power multiplier')],
        'X2Lib/X2DamageManager.cpp': [(301, 315, 'CAN_REFLEX decoded separately from effect REFLECT')],
    }
    sources = []
    for name, ranges in spans.items():
        path = ROOT/'.cache/native-source-runtime'/name
        raw = path.read_bytes()
        reference = known[name]
        if sha(raw) != reference['sha256']: raise ValueError('Prior source classification does not match current bytes: '+name)
        lines = raw.splitlines(keepends=True)
        sources.append({'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha(raw), 'bytes': len(raw),
            'evidenceClass': reference['evidenceClass'], 'classificationContract': 'contracts/rf-archenemy-trigger-source-v8.json',
            'spans': [{'startLine': first, 'endLine': last, 'meaning': meaning,
                'sha256': sha(b''.join(lines[first-1:last])), 'bytes': len(b''.join(lines[first-1:last]))} for first, last, meaning in ranges]})
    attributes = json.loads((ROOT/'contracts/rs-attributes-source-v1.json').read_text('utf8'))
    passive = next(v['21409'] for v in attributes.values() if isinstance(v, dict) and '21409' in v)
    output = {'schemaVersion': 1, 'originalClientMeasured': False, 'fullClientExecuted': False,
        'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633', 'sourceFiles': sources,
        'independentExpectations': {'initialReflectionCount': 2, 'effectReflectDefault': False,
            'damageCanReflexDefault': False, 'stateWindow': {'lowerBound': 'strict > start', 'upperBound': 'strict < end', 'requiresAttackerFront': True},
            'rsPassive': {'skillId': 21409, 'targetOriginalSource': attributes['sources']['NewSkillTempletVer2.lua'],
                'rawReflectRates': passive['raw']['SA_REFLECT_REL'], 'level3PvpRate': .09,
                'rawDescriptionExclusion': 'Special Active Skill excluded',
                'referenceRoll': 'GetRandomFloat() <= GetMagicReflectRate()', 'referenceFrontWindowGate': False},
            'defenderReactionGate': '(revenge && CAN_REVENGE) || (reflexMagic && CAN_REFLEX)',
            'reactionParticles': {'gate': 'RT_REVENGE/RT_REFLECT with reflectCount > 0; independent of effect REFLECT',
                'position': 'original damage impactPoint',
                'entries': [
                    {'name': 'RevengeImpactSlashCW', 'family': 'major', 'literalSequenceArguments': [50, 50, 1, 3]},
                    {'name': 'RevengeImpactSlashCCW', 'family': 'major', 'literalSequenceArguments': [50, 50, 1, 3]},
                    {'name': 'RevengeImpact', 'family': 'major', 'literalSequenceArguments': [50, 50, 1, 1]},
                    {'name': 'RevengeImpactTick', 'family': 'minor', 'literalSequenceArguments': [200, 200, 2, 20],
                        'landPosition': 'original m_fLandPos'}]},
            'worldColorFeedback': {'gate': 'RT_REVENGE/RT_REFLECT and game exists; independent of effect REFLECT and remaining count',
                'initialArgb': '0xff000000', 'fadeTarget': 'world GetOriginColor()', 'fadeSeconds': 1.0},
            'recreateGateWithFixMacro': 'effect REFLECT && reflectCount > 0',
            'recreation': {'oldLive': False, 'owner': 'defender', 'template': 'original m_Name', 'power': 'current m_fPowerRate',
                'position': 'original mesh current full position', 'angle': 'original mesh angle; Z += 180 degrees',
                'landPosition': 'original m_fLandPos', 'reflected': True, 'reflectionCount': 'prior count - 1'},
            'powerBeforeRecreation': 'GUUser scales original effect power by equipped reflect-skill/buff multiplier; default 1'},
        'limits': ['All inspected source bytes match the prior fixed-V5 classifications; no 2026-modified reconstruction was substituted.',
            'FIX_EFFECT_REFLECT and other compile-time branches are source evidence; target2016 enabled macro set is unmeasured.',
            'The strict directional window is the active-state path, not an extra gate on the separate RS passive roll.',
            'Web ownership, cross-profession frozen definitions, synchronization and tests remain implementation evidence.',
            'Web life epochs, immutable receipt identity checks, monotonic notices and the 0.5-second notice window are host protocol adapters, not original network packet evidence.']}
    destination = ROOT/'contracts/rs-reflection-source-v1.json'
    destination.write_bytes((json.dumps(output, ensure_ascii=False, indent=2)+'\n').encode('utf8'))
    print(json.dumps({'sources': len(sources), 'classification': sorted({r['evidenceClass'] for r in sources}), 'sha256': sha(destination.read_bytes())}))


if __name__ == '__main__': main()
