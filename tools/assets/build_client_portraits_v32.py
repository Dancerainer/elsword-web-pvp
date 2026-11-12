"""Crop original LARGE portraits into this task's assets; never enlarge pixels."""
from pathlib import Path
import argparse, hashlib, json, sys
from PIL import Image, ImageDraw
sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parent / 'character')]
from ui import read_tet, crop_piece
from build_rf import Catalog
from build_lk_sword_ui import inspect_picture_groups

ROOT = Path(__file__).resolve().parents[2]
PORTRAITS = {
    'LK': ('DLG_UI_Common_Texture17_NEW', 'L_KNIGHT_LARGE'),
    'RS': ('DLG_UI_Common_Texture17_NEW', 'R_SLAYER_LARGE'),
    'IS': ('DLG_UI_Common_Texture66_NEW', 'I_SWORD_LARGE'),
    'RF': ('DLG_UI_Common_Texture44_NEW', 'R_FIST_LARGE'),
    'BM': ('DLG_UI_Common_Texture44_NEW', 'B_MASTER_LARGE'),
    'VC': ('DLG_UI_Common_Texture25_NEW', 'V_COMMANDER_LARGE'),
    'GM': ('DLG_UI_Common_Texture76_NEW', 'EL_SGM_LARGE'),
    'BH': ('DLG_UI_Common_Texture76_NEW', 'EL_SBH_LARGE'),
    'CA': ('DLG_UI_Common_Texture85_NEW', 'EL_SCA_LARGE'),
    'LP': ('DLG_UI_Common_Texture81_NEW', 'ADD_ALP_LARGE'),
    'MM': ('DLG_UI_Common_Texture82_NEW', 'ADD_AMM_LARGE'),
    'DE': ('DLG_UI_Common_Texture86_NEW', 'ADD_ADE_LARGE'),
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/ui/lobby/portraits')
    args = parser.parse_args()
    output, source = args.output.resolve(), args.source.resolve()
    if output.is_relative_to(source) or not output.is_relative_to(ROOT):
        raise ValueError('Output must stay in this task and outside read-only inputs')
    catalog = Catalog(source); output.mkdir(parents=True, exist_ok=True)
    pieces = {}; sheet = Image.new('RGBA', (4 * 175, 3 * 193), '#111923')
    draw = ImageDraw.Draw(sheet)
    for index, (job, (atlas, key)) in enumerate(PORTRAITS.items()):
        texture, table = catalog.path(atlas + '.tga'), catalog.path(atlas + '.tet')
        crop, bounds = crop_piece(Image.open(texture).convert('RGBA'), read_tet(table.read_bytes())[key])
        if crop.width < 160 or crop.height < 160:
            raise ValueError('Insufficient source resolution: ' + job)
        file = output / (job.lower() + '.png'); crop.save(file)
        pieces[job] = {'file': file.name, 'width': crop.width, 'height': crop.height,
                       'piece': key, 'bounds': bounds, 'atlasSource': catalog.evidence(texture),
                       'tetSource': catalog.evidence(table), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
        x, y = (index % 4) * 175 + 6, (index // 4) * 193 + 5
        sheet.alpha_composite(crop, (x, y)); draw.text((x + 60, y + 170), job, fill='white')
    receipt = {'schemaVersion': 1, 'target': 'Steam-NA-2016-V6.0420.5', 'displayOnly': True,
               'method': 'Exact original TET crops without upscaling or generated pixels',
               'pieces': pieces, 'nativeClientMeasured': False}
    (ROOT / 'contracts/client-portraits-v32.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', 'utf8')
    dialog = catalog.path('DLG_Add_DP_And_Mutation.lua')
    groups = inspect_picture_groups(dialog.read_bytes())
    points = {row['piece'].upper(): row['position'] for row in groups['g_pStatic_DP_Gage']}
    mutations = groups['g_pStatic_Mutation_Gage']; origin = mutations[0]['position']
    layout = {'schemaVersion': 1, 'displayOnly': True, 'nativeClientMeasured': False,
              'sourceDialog': catalog.evidence(dialog),
              'dpFillOffset': [points['BG_DPSYSTEM_GAUGE'][i] - points['BG_DPSYSTEM_BACK'][i] for i in range(2)],
              'mutationOffsets': [[row['position'][i] - origin[i] for i in range(2)] for row in mutations[1:]]}
    (ROOT / 'contracts/add-status-layout-v32.json').write_text(json.dumps(layout, ensure_ascii=False, indent=2) + '\n', 'utf8')
    proof = ROOT / 'runtime/client-skills-ui-v32/portraits.png'; proof.parent.mkdir(parents=True, exist_ok=True); sheet.save(proof)
    print(json.dumps({job: [row['width'], row['height']] for job, row in pieces.items()}))

if __name__ == '__main__':
    main()
