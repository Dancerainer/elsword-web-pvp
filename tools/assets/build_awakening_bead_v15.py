"""Align the original Raven flame birth band with the third bead, not its ornament."""
import argparse
import json
from pathlib import Path
from build_awakening_bead_v14 import ROOT, NAME, build, inspect_layout


def align_birth_band(index, catalog):
    # RAVEN_3 includes a long highlight on the right. Its full texture rectangle
    # center is not the center of the orb. The surrounding Raven frame supplies
    # the common local center without changing any original particle fields.
    background = inspect_layout(catalog.path('DLG_PVP_Game_My_State_NEW.lua'),
        catalog.path('DLG_UI_Common_Texture25_NEW.tet'), 'RAVEN_3_BG', (50, 54),
        (46, 41), 'StaticPVPGameStateWakeSlot')
    if background['size'] != [46, 41]:
        raise ValueError('Target third-bead frame changed; recheck its display pivot')
    center = background['center']
    radius = index['templates'][NAME]['fields']['Emitradius']
    if radius[1] != {'random': [16.0, 22.0]}:
        raise ValueError('Original Raven flame birth band changed')
    band_center = sum(radius[1]['random']) / 2
    index['targetFrameLayout'] = background
    index['presentation'] = {
        'anchor': 'third-bead frame center minus original vertical birth-band midpoint',
        'hudLocalPosition': [center[0], center[1] - band_center, 0],
        'beadCenter': center,
        'birthBandMidpoint': [0, band_center, 0],
        'classification': 'user-requested NEW HUD display alignment; not a verified 2016 native screen point',
    }
    index['limits'].append('Flame placement is a display adaptation to the visible third orb; original GPU comparison unavailable')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=Path('asset_work'))
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--output', type=Path, default=ROOT / 'artifacts/ui/awakening-bead')
    a = p.parse_args()
    print(json.dumps(build(a.source, a.reference, a.output,
        contract_path=ROOT / 'contracts/rf-awakening-bead-fx-v15.json',
        report_path=ROOT / 'reports/rf-awakening-bead-handover-v15.json',
        adapt_layout=align_birth_band), ensure_ascii=False))
