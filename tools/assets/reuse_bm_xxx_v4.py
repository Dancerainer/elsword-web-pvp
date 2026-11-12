"""Reuse RF's existing original XXX bytes for the user-authorized BM adapter.

Only the current task's BM metadata is written. Existing converted inputs are
read and checked; this tool does not reconvert or overwrite shared assets.
"""
import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/combat'))
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_bm_profile import build, strings
from audio import effect_sound_references

def read(path): return json.loads(path.read_text('utf8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', 'utf8', newline='\n')

def main():
    bm = ROOT/'artifacts/bm'
    rf = ROOT/'artifacts/rf'
    profile_path = ROOT/'packages/combat-core/bm-profile.json'
    index = read(bm/'fx/index.json')
    source_index = read(rf/'fx/index.json')['templates']
    source = source_index['RAVEN_RF_XXX_ATTACK_BOX']
    if source['declarationSha256'] != '3993e930ce673415981f286491aecdaf169929741d30692ac563def703b74ba7':
        raise ValueError('Original XXX mesh declaration changed')
    rf_profile = read(ROOT/'packages/combat-core/rf-profile.json')
    pending = list(strings([rf_profile['effectSets']['EffectSet_A_RF_XXX'],rf_profile['damageEffects']['DamageEffect_RF_XXX']]))
    seen, reused = set(), []
    while pending:
        name = pending.pop()
        if name in seen: continue
        seen.add(name)
        if name not in source_index: continue
        original = source_index[name]
        pending.extend(strings(original))
        template = copy.deepcopy(original)
        records = [(template,key) for key in ('glb','poseData') if template.get(key)]
        records.extend((texture,'file') for texture in template.get('textures',{}).values())
        for record,key in records:
            source_file = (rf/record[key]).resolve()
            if not source_file.is_relative_to(ROOT/'artifacts') or not source_file.is_file():
                raise ValueError('Original RF XXX runtime input missing: '+str(source_file))
            reused.append(source_file)
            record[key] = '../rf/'+record[key]
        if name in index['templates']: continue
        index['templates'][name] = template
        if name not in index['sharedTemplates']: index['sharedTemplates'].append(name)
    write(bm/'fx/index.json', index)
    profile = build(ROOT/'.cache/bm', bm)
    write(profile_path, profile)
    seal = sha(profile_path)
    index['profileSha256'] = seal
    write(bm/'fx/index.json', index)
    write(ROOT/'contracts/bm-fx-index.json', index)
    write(bm/'effect-assets.json', {'schemaVersion': 1, 'templates': index['templates']})
    manifest = read(bm/'manifest.json')
    manifest['effectTemplates'] = {'schemaVersion': 1, 'templates': index['templates']}
    manifest['profile'].update(profileId=profile['profileId'], sha256=seal)
    write(bm/'manifest.json', manifest)
    audio = read(bm/'audio/manifest.json')
    audio['profile'].update(profileId=profile['profileId'], sha256=seal)
    record = copy.deepcopy(read(ROOT/'artifacts/audio/manifest.json')['files']['Elsword_Big_Burst.ogg'])
    record['source']['raw_path'] = record['source']['rawPath']
    raw = (ROOT/'artifacts/audio'/record['file']).read_bytes()
    if len(raw) != record['bytes'] or hashlib.sha256(raw).hexdigest() != record['sha256']:
        raise ValueError('Original RF/common XXX audio differs')
    record.update(file='../audio/'+record['file'], sharedSource='RF/common audio exact SHA256')
    audio['files']['Elsword_Big_Burst.ogg'] = record
    audio['effectSounds'] = effect_sound_references(profile)
    write(bm/'audio/manifest.json', audio)
    files = ['manifest.json', 'effect-assets.json', 'fx/index.json', 'audio/manifest.json']
    handoff = {'schemaVersion': 1, 'clientMeasured': False,
        'profileSha256': seal, 'metadata': [{'file': 'artifacts/bm/'+file,
            'bytes': (bm/file).stat().st_size, 'sha256': sha(bm/file)} for file in files],
        'reusedInputs': [{'file': 'artifacts/'+path.relative_to(ROOT/'artifacts').as_posix(),
            'sha256': sha(path), 'bytes': path.stat().st_size} for path in sorted(set(reused))],
        'sharedAudio': record,
        'limits': ['No new binary runtime resource; existing RF XXX mesh and common audio are reused.',
            'Target2016 native owner callback and target MP gate are unavailable.',
            'The final integrator must refresh cast-display/profile and runtime asset seals.']}
    write(ROOT/'reports/bm-feedback-handoff-v4.json', handoff)
    print(json.dumps({'profileSha256': seal, 'metadataFiles': len(files), 'newBinaryFiles': 0}))

if __name__ == '__main__': main()
