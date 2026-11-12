"""Seal and pack only this task's Blade Master runtime resources."""
import json
from pathlib import Path
from finalize_lk_assets import finalize, write_json, digest
from pack_vc_runtime import pack

ROOT = Path(__file__).resolve().parents[2]


def main():
    output = ROOT/'artifacts/bm'
    profile_path = ROOT/'packages/combat-core/bm-profile.json'
    manifest = json.loads((output/'manifest.json').read_text('utf8'))
    rf = json.loads((ROOT/'artifacts/rf/manifest.json').read_text('utf8'))
    core = dict(rf['mechanismResources']['ravenNasodCore'])
    core['glb'] = '../rf/'+core['glb']
    manifest['mechanismResources'] = {'ravenNasodCore': core,
        'awakening': {'characterClip': 'BoostPower', 'timeSemantics': 'shared Raven source consumer'}}
    write_json(output/'manifest.json', manifest)
    finalize(output, profile_path, 'bm', ('Bip01_L_Hand', 'Bip01_L_Forearm', 'Dummy2_Lhand'))
    reuse = pack('bm')
    # Packing changes only local resource references. Refresh the profile via
    # its original builder, retaining source metadata and actor rules.
    import sys
    sys.path.insert(0, str(ROOT/'tools/combat'))
    from build_bm_profile import build
    write_json(profile_path, build(ROOT/'.cache/bm', output))
    profile = json.loads(profile_path.read_text('utf8'))
    sha = digest(profile_path.read_bytes().replace(b'\r\n', b'\n'))
    manifest = json.loads((output/'manifest.json').read_text('utf8'))
    manifest['profile'].update(profileId=profile['profileId'], sha256=sha)
    write_json(output/'manifest.json', manifest)
    fx = json.loads((output/'fx/index.json').read_text('utf8'))
    fx['profileSha256'] = sha
    write_json(output/'fx/index.json', fx)
    write_json(ROOT/'contracts/bm-fx-index.json', fx)
    audio = json.loads((output/'audio/manifest.json').read_text('utf8'))
    audio['profile'].update(profileId=profile['profileId'], sha256=sha)
    # Command FX closure can add sound declarations while --fx-only retains
    # the already converted audio bytes. Keep those references in the seal.
    from audio import effect_sound_references
    audio['effectSounds'] = effect_sound_references(profile)
    missing = sorted({row['FILE_NAME'] for sounds in audio['effectSounds'].values()
                      for row in sounds.values() if row['FILE_NAME'] not in audio['files']})
    if missing:
        raise ValueError('New BM effect audio needs original conversion: '+str(missing))
    write_json(output/'audio/manifest.json', audio)
    audio_report = json.loads((ROOT/'reports/bm-audio.json').read_text('utf8'))
    audio_report.update(profile=audio['profile'], files=audio['files'], effectSounds=audio['effectSounds'])
    write_json(ROOT/'reports/bm-audio.json', audio_report)
    for row in reuse['outputs']:
        raw = (output/row['file']).read_bytes()
        row.update(sha256=digest(raw), bytes=len(raw))
    reuse['runtimeBytes'] = sum(row['bytes'] for row in reuse['outputs'])
    write_json(ROOT/'reports/bm-resource-reuse-v1.json', reuse)
    report = json.loads((ROOT/'reports/bm-assets-runtime.json').read_text('utf8'))
    report.update(outputs=reuse['outputs'], profile=manifest['profile'])
    report['summary'].update(files=len(reuse['outputs']), bytes=reuse['runtimeBytes'])
    write_json(ROOT/'reports/bm-assets-runtime.json', report)


if __name__ == '__main__':
    main()
