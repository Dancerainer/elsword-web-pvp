"""Extract the original MM installed-skill overlay; source inputs stay read-only."""
from pathlib import Path
import hashlib, json, sys
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/assets'), str(ROOT / 'tools/assets/character')]
from ui import read_tet, crop_piece
from build_rf import Catalog, digest

def main():
    catalog = Catalog(Path('asset_work'))
    atlas = catalog.path('DLG_UI_Common_Texture63_NEW.tga')
    tet = catalog.path('DLG_UI_Common_Texture63_NEW.TET')
    piece = read_tet(tet.read_bytes())['BG_ADD_SKILLSLOT']
    with Image.open(atlas) as original: crop, bounds = crop_piece(original.convert('RGBA'), piece)
    output = ROOT / 'artifacts/ui/add/bg_add_skillslot.png'
    output.parent.mkdir(parents=True, exist_ok=True);crop.save(output)
    ui = json.loads((ROOT / 'artifacts/ui/DLG_GAME_SKILL_SLOT_NEW.json').read_text('utf8'))
    if digest(Path(ui['source']['path']).read_bytes()) != ui['source']['sha256']:
        raise ValueError('Original skill slot script changed')
    pictures = [row for row in ui['nativeCalls'] if row['target'].endswith('.SetTex') and row['args'][1:] == ['DLG_UI_Common_Texture63_NEW.TGA','BG_ADD_SKILLSLOT']]
    if len(pictures) != 8: raise ValueError('Unexpected installed-skill original UI count')
    value = {'schemaVersion':1, 'originalClientMeasured':False, 'evidenceClass':'target2016 original UI picture and qualified reference selection rule',
        'file':'ui/add/bg_add_skillslot.png','piece':'BG_ADD_SKILLSLOT','bounds':bounds,'width':crop.width,'height':crop.height,
        'sha256':digest(output.read_bytes()), 'atlasSource':catalog.evidence(atlas),'tetSource':catalog.evidence(tet),
        'originalUI':{'source':ui['source'],'control':'Static_Install_Skill','pictureCount':len(pictures),'nativeCalls':pictures},
        'qualifiedConsumer':{'path':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GUAdd.cpp','commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
            'sha256':'b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a','method':'ThirdPath_GetInstallSlotOverlayIndex','lines':[17783,17790],
            'selectedSkillOverlayIndex':30,'unselectedOverlayIndex':-1,'laterReconstruction':True,
            'interpretation':'This qualified reference returns a selected-skill overlay index. Original2016 UI independently binds eight BG_ADD_SKILLSLOT pictures. No verified target2016 numeric-index mapping was obtained; the Web adapter uses the named original overlay only.'},
        'iconBoundary':'Original skill templates keep their INSTALLATION icon piece for both selection and firing. No alternate firing icon is declared. Preserve each original icon and show the installed selection with this original overlay.'}
    (ROOT / 'contracts/mm-generator-ui-v32.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'file':value['file'],'width':crop.width,'height':crop.height,'sha256':value['sha256']}))

if __name__ == '__main__':main()
