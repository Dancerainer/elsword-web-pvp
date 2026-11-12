"""Parse Elesis source declarations without executing Lua/native callbacks."""
from pathlib import Path
from prepare_lk_declarations import NAMES, prepare

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=Path('.cache/elesis-target'))
    args = parser.parse_args()
    names = {**NAMES, 'elsword': 'ELESIS_KNIGHT.lua'}
    # The target unit file includes one native registration: retain, never run it.
    prepare(args.source_root, args.output, names, ())
