"""Restore IS declarations through the shared hash-checked Elsword parser."""
from pathlib import Path
from prepare_lk_declarations import prepare
if __name__ == '__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=Path('.cache/is-target'))
    a=p.parse_args();prepare(a.source_root,a.output)
