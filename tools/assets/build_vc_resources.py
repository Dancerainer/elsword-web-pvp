"""Build VC resources with original-byte reuse of RF and LK conversions."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import write_json
from build_lk_fx import build as build_fx
from lk_skill_ui import build as build_ui
import audio
from vc_presentation_resources import add_vc_presentation_resources

def build():
    profile=ROOT/'packages/combat-core/vc-profile.json'
    source=Path('asset_work'); output=ROOT/'artifacts/vc'
    shared=[(p, '../rf/') for p in sorted((ROOT/'artifacts/rf').glob('*/index.json'))]
    shared += [(ROOT/'artifacts/lk/fx/index.json','../lk/')]
    build_fx(output/'fx', profile, source, ROOT/'contracts/vc-fx-index.json', shared_indexes=shared)
    add_vc_presentation_resources(output)
    build_ui(source, ROOT/'artifacts/ui/skills/vc', profile, output/'ui',
         profession_id='vc', unit_class=115,
        portrait_atlas='DLG_UI_Common_Texture25_NEW', portrait_prefix='V_COMMANDER')
    manifest=audio.build(profile,source,output/'audio',ROOT/'reports/vc-audio.json')
    for row in manifest['files'].values(): row['file']='../vc/audio/'+row['file']
    write_json(output/'audio/manifest.json',manifest)

if __name__ == '__main__': build()
