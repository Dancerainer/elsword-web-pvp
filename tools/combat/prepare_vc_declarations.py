"""VC uses the shared hash-checked KL parser, preserving the whole Raven table."""
import argparse
from pathlib import Path
from prepare_lk_declarations import NAMES, prepare

VC_NAMES = {key: value for key, value in NAMES.items() if key not in ('elsword', 'way-of-sword')}
VC_NAMES = {'enum': VC_NAMES.pop('enum'), 'raven': 'RAVEN_FIGHTER.lua', **VC_NAMES}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=Path('.cache/vc'))
    args = parser.parse_args()
    prepare(args.source_root, args.output, VC_NAMES, ('raven',))
