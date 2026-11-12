"""Build Blade Master FX, original portraits, skill icons and audio by reuse."""
import argparse
import json
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import write_json
from build_lk_fx import build as build_fx
from lk_skill_ui import build as build_ui
from vc_presentation_resources import extend
import audio


def audit_presentation_sources(source):
    sys.path.insert(0, str(ROOT/'tools/combat'))
    from build_rf import Catalog
    from kl82_static import read_declarations
    catalog = Catalog(source)
    enum = read_declarations(catalog.path('Enum.lua'))['globals']
    path = catalog.path('DamageEffect.lua')
    damage = read_declarations(path, enum, True, True)['globals']
    effect_path = catalog.path('EffectSet.lua')
    effects = read_declarations(effect_path, enum, True, True)
    extreme = next(c['args'][-1] for c in effects['nativeCalls']
                   if c['target'].endswith('AddEffectSetTemplet_LUA')
                   and c['args'][-1].get('NAME') == 'EffectSet_SA_RBM_Extrem_Blade_Start')
    from build_rf import digest
    collision_name = 'EffectSet_RBM_HYPER_STEP_EXPLO_P13'
    duplicate_templates = []
    for key in sorted(catalog.rows):
        if key.endswith('.txt') and ('particle' in key or 'meshplayer' in key):
            script = catalog.path(key)
            raw = script.read_bytes().decode('latin1')
            for match in re.finditer(r'(TEMPLET|eventsequence)\s+"'+collision_name+r'"\s*\{([^{}]*)\}', raw):
                duplicate_templates.append({'kind': 'mesh' if match[1] == 'TEMPLET' else 'particle',
                    'source': {**catalog.evidence(script), 'byteOffset': match.start(),
                        'line': raw.count('\n', 0, match.start())+1},
                    'raw': match[0], 'declarationSha256': digest(match[0].encode('latin1'))})
    if extreme['EFFECT8']['EFFECT_TYPE'] != 4 or {r['kind'] for r in duplicate_templates} != {'mesh', 'particle'}:
        raise ValueError('BM typed namespace evidence changed; re-audit original consumers')
    name, owner = 'RAVEN_HYPER_SONIC_STAB_DOWN', 'DAMAGE_EFFECT_RSI_HA_RBM_EXTREM_BLADE_DAMAGE'
    if damage[owner]['HIT_PARTICLE3']['PARTICLE_NAME'] != name:
        raise ValueError('BM source hit-particle reference changed')
    searched, matches = [], []
    for key in sorted(catalog.rows):
        if key.endswith('.txt') and ('particle' in key or 'meshplayer' in key):
            script = catalog.path(key)
            searched.append(catalog.evidence(script))
            if name.encode() in script.read_bytes():
                matches.append(catalog.evidence(script))
    write_json(ROOT/'contracts/bm-presentation-source-v1.json', {
        'schemaVersion': 1, 'clientMeasured': False,
        'classification': 'target2016 declarations and exact-byte original resource search; no native client execution',
        'source': catalog.evidence(path), 'sharedAwakeningContract': 'contracts/rf-awakening-source-v17.json',
        'sharedAuraContract': 'contracts/rf-awakening-fx-index.json',
        'sharedLandingContract': 'contracts/rf-landing-fx-index-v1.json',
        'sharedHitContract': 'contracts/rf-hit-particle-consumers-source-v2.json',
        'typedNamespaceEntry': {'source': catalog.evidence(effect_path), 'effectSet': extreme['NAME'],
            'field': 'EFFECT8', 'raw': extreme['EFFECT8'], 'requestedKind': 'mesh',
            'declarations': duplicate_templates,
            'interpretation': 'Original ET_MESH_PLAYER lookup selects the mesh registry; the same-named particle is a separate declaration.'},
        'missingParticleReference': {'owner': owner, 'field': 'HIT_PARTICLE3', 'raw': damage[owner]['HIT_PARTICLE3'],
            'sameNamedDamageEffect': damage[name], 'matches': matches,
            'searchedOriginalParticleAndMeshScripts': searched,
            'interpretation': 'The source hit-particle name also names a DamageEffect; no template alias or damage conversion is invented.'}})


def build(fx_only=False):
    profile = ROOT/'packages/combat-core/bm-profile.json'
    source = Path('asset_work')
    output = ROOT/'artifacts/bm'
    audit_presentation_sources(source)
    shared = [(p, '../rf/') for p in sorted((ROOT/'artifacts/rf').glob('*/index.json'))]
    shared += [(ROOT/f'artifacts/{job}/fx/index.json', f'../{job}/') for job in ('lk', 'vc')]
    index = build_fx(output/'fx', profile, source, ROOT/'contracts/bm-fx-index.json', shared_indexes=shared)
    read = lambda p: json.loads(p.read_text('utf8'))
    index = extend(index, read(ROOT/'artifacts/rf/awakening-fx/index.json'),
                   read(ROOT/'contracts/rf-awakening-fx-index.json'),
                   evidence_contract='contracts/bm-presentation-source-v1.json')
    write_json(output/'fx/index.json', index)
    write_json(ROOT/'contracts/bm-fx-index.json', index)
    if fx_only:
        return
    build_ui(source, ROOT/'artifacts/ui/skills/bm', profile, output/'ui',
         profession_id='bm', unit_class=106,
        portrait_atlas='DLG_UI_Common_Texture25_NEW', portrait_prefix='B_MASTER')
    manifest = audio.build(profile, source, output/'audio', ROOT/'reports/bm-audio.json')
    for row in manifest['files'].values():
        row['file'] = '../bm/audio/'+row['file']
    write_json(output/'audio/manifest.json', manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fx-only', action='store_true', help='Preserve existing UI/localization and audio while refreshing source FX closure')
    build(parser.parse_args().fx_only)
