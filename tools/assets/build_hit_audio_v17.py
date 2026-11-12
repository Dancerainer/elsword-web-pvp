"""Freeze RF hit-sound lookup and SOUND records; copy original audio bytes only.

Target KL declarations are independent of fixed-V5 consumer candidates and of
current simulation traces. Inputs are read-only; outputs stay in this worktree.
"""
from pathlib import Path
import argparse, json, re, sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from kl82_static import read_declarations
from build_rf import Catalog, digest, write_json
from build_critical_fx import inspect_wave
from audio import inspect_ogg
from task_output import checked_output


def strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, dict):
        for item in value.values(): yield from strings(item)
    elif isinstance(value, list):
        for item in value: yield from strings(item)


def damage_records(value, path=''):
    if isinstance(value, dict):
        if 'DAMAGE' in value and ('REACT_TYPE' in value or 'HIT_TYPE' in value):
            yield {'path': path, 'hitType': value.get('HIT_TYPE', 0), 'reactType': value.get('REACT_TYPE', 0),
                'noDamage': value.get('NO_DAMAGE', 0)}
        for key, child in value.items(): yield from damage_records(child, path + '.' + key)


def safe_name(name):
    if not isinstance(name, str) or not re.fullmatch(r'[^/\\\x00]+\.(?:wav|ogg)', name, re.I):
        raise ValueError('Unsafe/unsupported literal audio name: ' + str(name))
    return name


def lookup(tables, hit_type, hitted_type):
    if hit_type == -1 or hitted_type == -1: return None
    table = tables.get(str(hit_type), {})
    return table.get(str(hitted_type)) or table.get('0') or tables.get('0', {}).get('0') or None


def build(source_root=Path('asset_work'), output=ROOT / 'artifacts/audio',
          output_root=None, project_root=ROOT):
    output = checked_output(output, source_root, ROOT, output_root, 'Hit audio')
    if output_root is not None:
        if not Path(project_root).absolute().is_relative_to(Path(output_root).absolute()):
            raise ValueError('Isolated audio reports must stay in the explicit output root')
        project_root = checked_output(project_root, source_root, ROOT, output_root, 'Audio reports')
    else:
        project_root = Path(project_root).resolve()
    catalog = Catalog(source_root)
    enum_path = catalog.path('Enum.lua'); enum = read_declarations(enum_path)['globals']
    sound_path = catalog.path('DamageSound.lua'); sound = read_declarations(sound_path)
    tables = {str(enum['HIT_TYPE'][name]): {str(enum['HITTED_TYPE'][key]): safe_name(value)
        for key, value in values.items()} for name, values in sound['globals'].items()
        if name in enum['HIT_TYPE']}
    profile = json.loads((ROOT / 'packages/combat-core/rf-profile.json').read_bytes())
    # Compare the independently decoded target effect SOUND records to the host
    # declarations. A profile-only string is not promoted into target evidence.
    damage_path = catalog.path('DamageEffect.lua')
    target_damage = read_declarations(damage_path, enum, True, True)['globals']
    effect_sounds = {}
    for name, row in profile['damageEffects'].items():
        records = {key: value for key, value in row['raw'].items() if re.fullmatch(r'SOUND\d+', key)}
        if records:
            original = {key: value for key, value in target_damage[name].items() if re.fullmatch(r'SOUND\d+', key)}
            if records != original: raise ValueError('Target effect sound declaration differs: ' + name)
            effect_sounds[name] = records
    runtime_sources = json.loads((ROOT / 'contracts/rf-native-runtime-sources.json').read_bytes())['files']
    cpp = []
    for relative in ['X2Lib/X2GUUser.cpp', 'X2Lib/X2GURaven.cpp', 'X2Lib/X2DamageManager.cpp', 'X2Lib/X2DamageEffect.cpp', 'KTDXLIB/KTDGXSkinAnim.cpp']:
        record = next(r for r in runtime_sources if r['relativePath'] == relative)
        data = (ROOT / '.cache/native-source-runtime' / relative).read_bytes()
        if digest(data) != record['sha256'] or len(data) != record['bytes']: raise ValueError('Frozen native sound source changed')
        cpp.append({'path': relative, 'localPath': '.cache/native-source-runtime/' + relative,
            'sha256': record['sha256'], 'bytes': record['bytes'], 'classification': 'fixed-V5-reference-not-target2016'})
    contract = {'schemaVersion': 1, 'targetClientMeasured': False,
        'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633', 'cppSources': cpp,
        'targetSources': [catalog.evidence(p) for p in (enum_path, sound_path, damage_path)],
        'bindings': {'hitTypes': enum['HIT_TYPE'], 'hittedTypes': enum['HITTED_TYPE'],
            'reactTypes': enum['REACT_TYPE'], 'damageSoundTables': tables,
            'rfHittedType': profile['components']['HITTED_TYPE'], 'effectSounds': effect_sounds,
            'soundDefaults': {'EVENT_TIME': 0, 'RATE': 100, 'USE_GLOBAL_TIME': False}},
        'referenceSounds': [{'name': 'Raven_ElectricAura_Disappear.ogg', 'source': 'X2Lib/X2GURaven.cpp',
            'line': 21846, 'classification': 'fixed-V5 awakening-end consumer; target2016 unmeasured'}],
        'consumerLines': {'X2GUUser.cpp': {'hitSound': [8326, 8354]},
            'X2DamageManager.cpp': {'lookup': [2756, 2797], 'missBeforeDamageReact': [1499, 1542]},
            'X2DamageEffect.cpp': {'soundFrame': [2534, 2606], 'soundLoad': [7050, 7069]},
            'KTDGXSkinAnim.cpp': {'eventTimer': [1350, 1357]}},
        'limits': ['Target2016 declarations/audio are verified; fixed-V5 triggers remain candidates, not original-client measurements.',
            'RT_NO_DAMAGE/RT_SENSOR and HT_NO_SOUND/HTD_NO_SOUND suppress hit sound; NO_DAMAGE alone does not suppress RT_DUMMY_DAMAGE.',
            'SOUND records use independent mesh clocks and play once even on misses; they are not per-hit sounds.',
            'RF material is target HITTED_TYPE=HTD_MEAT; other characters, reflect/revenge remapping and native 3D/mixer gain remain outside this adaptation.']}
    write_json(project_root / 'contracts/rf-hit-audio-source-v17.json', contract)
    # A finite closure: all RF declarations plus fixed-source literal callback
    # roots from the existing audit, without importing other character audio.
    nodes = {**profile['states'], **profile['effectSets'], **profile['damageEffects']}
    def closure(roots):
        pending = list(roots); found = set()
        while pending:
            name = pending.pop()
            if name in found or name not in nodes: continue
            found.add(name); pending.extend(strings(nodes[name]['raw']))
        return sorted(found)
    def row(kind, identity, roots):
        names = closure(roots); hits = [record for name in names for record in damage_records(nodes[name]['raw'], name)]
        sounds = sorted({safe_name(s) for name in names for s in strings(nodes[name]['raw']) if s.lower().endswith(('.ogg', '.wav'))})
        hit_names = sorted({n for h in hits if type(h['hitType']) is int and (n := lookup(tables, h['hitType'], profile['components']['HITTED_TYPE']))})
        return {'kind': kind, 'id': identity, 'nodes': names, 'declaredSounds': sounds, 'damageRecords': hits,
            'rfHitSounds': hit_names, 'unresolvedHitTypes': [h for h in hits if type(h['hitType']) is not int],
            'classification': 'target-declaration closure + labelled reference roots; live traces are separate; no target client measurement'}
    combo = json.loads((ROOT / 'reports/rf-all-combo-source-audit-v9.json').read_bytes())['rows']
    raven = (ROOT / '.cache/native-source-runtime/X2Lib/X2GURaven.cpp').read_bytes().decode('latin1').splitlines()
    rows = []
    for r in combo:
        if not r['presentAtBaseline']: continue
        literals = [s for f in r['sourceMethods'] for s in re.findall(r'L"([^"\n]+)"', '\n'.join(raven[f['startLine']-1:f['endLine']]))]
        rows.append(row('combo', r['state'], [r['state'], *literals]))
    skills = json.loads((ROOT / 'reports/rf-full-skill-catalog-v1.json').read_bytes())['highestSkills']
    for s in skills:
        if s['passive']: continue
        rows.append(row('active', s['skillId'], [*s['states'], *(v for f in s['callbacks'] for v in f['stringLiterals'])]))
    if len(rows) != 52: raise ValueError('Incomplete 32-combo/20-active coverage')
    # Also cover damage definitions already owned by the finite RF profile so
    # descendant/recovered sources cannot silently miss a WAV dependency.
    hits = list(damage_records(profile))
    names = {safe_name(s) for s in strings(profile['damageEffects']) if s.lower().endswith(('.ogg', '.wav'))}
    names.update(n for h in hits if type(h['hitType']) is int and (n := lookup(tables, h['hitType'], profile['components']['HITTED_TYPE'])))
    names.update(r['name'] for r in contract['referenceSounds'])
    manifest = json.loads((output / 'manifest.json').read_bytes())
    copied = {}
    for name in sorted(names):
        source = catalog.path(name); data = source.read_bytes()
        metadata = inspect_ogg(data) if name.lower().endswith('.ogg') else inspect_wave(data)
        (output / name).write_bytes(data)
        record = {'file': name, 'sha256': digest(data), 'bytes': len(data), 'source': catalog.evidence(source),
            'mimeType': 'audio/ogg' if name.lower().endswith('.ogg') else 'audio/wav', 'format': metadata}
        manifest['files'][name] = record; copied[name] = record
    manifest['hitAudioContract'] = 'contracts/rf-hit-audio-source-v17.json'
    write_json(output / 'manifest.json', manifest)
    write_json(project_root / 'reports/rf-hit-audio-coverage-v17.json', {'schemaVersion': 1, 'targetClientMeasured': False,
        'counts': {'combos': 32, 'actives': 20}, 'rows': rows})
    write_json(project_root / 'reports/rf-hit-audio-assets-v17.json', {'schemaVersion': 1, 'targetClientMeasured': False,
        'output': output.relative_to(ROOT).as_posix(), 'addedOrVerifiedFiles': copied,
        'files': {'manifest.json': {'sha256': digest((output / 'manifest.json').read_bytes()), 'bytes': (output / 'manifest.json').stat().st_size},
            **{name: {'sha256': r['sha256'], 'bytes': r['bytes']} for name, r in copied.items()}},
        'sourceContractSha256': digest((project_root / 'contracts/rf-hit-audio-source-v17.json').read_bytes())})
    return contract


if __name__ == '__main__':
    args = argparse.ArgumentParser(description=__doc__); args.add_argument('--source-root', type=Path, default=Path('asset_work'))
    args.add_argument('--output', type=Path, default=ROOT / 'artifacts/audio')
    args.add_argument('--output-root', type=Path, help='Explicit physical task runtime root for isolated rebuilds')
    args.add_argument('--project-root', type=Path, default=ROOT, help='Contract/report output directory, within output-root for isolated rebuilds')
    options = args.parse_args(); result = build(options.source_root, options.output, options.output_root, options.project_root)
    print(json.dumps({'hitTypes': len(result['bindings']['hitTypes']), 'effectSoundOwners': len(result['bindings']['effectSounds']), 'rows': 52}))
