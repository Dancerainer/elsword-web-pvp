"""Read-only original BM declarations through the shared hash-checked parser."""
import argparse
from pathlib import Path
from prepare_vc_declarations import VC_NAMES
from prepare_lk_declarations import prepare

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=Path('.cache/bm'))
    args = parser.parse_args()
    prepare(args.source_root, args.output, VC_NAMES, ('raven',))
