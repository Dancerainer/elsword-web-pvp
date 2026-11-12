"""Build IS target resource closure, sharing only identical original declarations.

The existing SwordMan awakening/Way of Sword roots apply to IS as well as LK.
IS skill roots come exclusively from the original IS profile declarations.
"""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import write_json
from build_lk_fx import build as build_fx
from lk_presentation_roots import PRESENTATION_ROOTS, ARMAGEDDON_CAST_ROOTS
from lk_skill_ui import build as build_ui
import audio


def build_audio():
    profile = ROOT/'packages/combat-core/is-profile.json'
    source = Path('asset_work')
    output = ROOT/'artifacts/is'
    audio.VERSION = 'is-audio-target2016-v1'
    manifest = audio.build(profile, source, output/'audio', ROOT/'reports/is-audio.json',
                           ROOT/'contracts/lk-native-sound-triggers-v2.json')
    for row in manifest['files'].values():
        row['file'] = '../is/audio/'+row['file']
    write_json(output/'audio/manifest.json', manifest)


def build():
    profile = ROOT/'packages/combat-core/is-profile.json'
    source = Path('asset_work')
    output = ROOT/'artifacts/is'
    shared = [(ROOT/'artifacts/lk/fx/index.json', '../lk/')]
    shared += [(p, '../rf/') for p in sorted((ROOT/'artifacts/rf').glob('*/index.json'))]
    shared += [(ROOT/'artifacts/vc/fx/index.json', '../vc/')]
    roots = tuple(r for r in PRESENTATION_ROOTS if r not in ARMAGEDDON_CAST_ROOTS)
    original = json.loads((ROOT/'contracts/lk-presentation-roots.json').read_text('utf8'))
    proof = {**original, 'professionId': 'is', 'roots': roots,
        'sharedConsumerEvidence': 'contracts/lk-presentation-roots.json',
        'scope': 'Common SwordMan/actor callbacks only; LK Armageddon-specific roots excluded'}
    proof['consumers'] = [c for c in original['consumers'] if any(r in roots for r in c.get('roots', []))]
    write_json(ROOT/'contracts/is-presentation-roots.json', proof)
    build_fx(output/'fx', profile, source, ROOT/'contracts/is-fx-index.json', shared_indexes=shared)
    build_ui(source, ROOT/'artifacts/ui/skills/is', profile, output/'ui',
         profession_id='is', unit_class=112,
        portrait_atlas='DLG_UI_Common_Texture66_NEW', portrait_prefix='I_SWORD',
        portrait_pieces={'STATE': 'I_SWORD_FACE'})
    build_audio()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio-only',action='store_true',help='Refresh audio closure after final profile metadata is sealed')
    args=parser.parse_args()
    build_audio() if args.audio_only else build()
