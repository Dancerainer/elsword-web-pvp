"""Convert RS resources with exact original declaration/byte reuse from LK and RF."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import write_json
from build_lk_fx import build as build_fx
from lk_skill_ui import build as build_ui
import audio


def build():
    profile = ROOT/'packages/combat-core/rs-profile.json'
    source = Path('asset_work')
    output = ROOT/'artifacts/rs'
    shared = [(ROOT/'artifacts/lk/fx/index.json', '../lk/')]
    shared.extend((p, '../rf/') for p in sorted((ROOT/'artifacts/rf').glob('*/index.json')))
    build_fx(output/'fx', profile, source, ROOT/'contracts/rs-fx-index.json', shared_indexes=shared)
    build_ui(source, ROOT/'artifacts/ui/skills/rs', profile, output/'ui',
         profession_id='rs', unit_class=101,
        portrait_atlas='DLG_UI_Common_Texture16_NEW', portrait_prefix='R_SLAYER')
    audio.VERSION = 'rs-audio-target2016-v1'
    manifest = audio.build(profile, source, output/'audio', ROOT/'reports/rs-audio.json',
        ROOT/'contracts/lk-native-sound-triggers-v2.json')
    for row in manifest['files'].values():
        row['file'] = '../rs/audio/'+row['file']
    write_json(output/'audio/manifest.json', manifest)


if __name__ == '__main__': build()
