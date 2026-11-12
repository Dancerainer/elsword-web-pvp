"""Read-only scene candidate inventory; output is static evidence."""
import argparse
import collections
import json
from pathlib import Path
import sqlite3
from scene_kl import recover, vector, display


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-root', type=Path, default=Path('asset_sources/upstream'))
    ap.add_argument('--scene', action='append')
    args = ap.parse_args()
    source = args.source_root / 'asset_work'
    db = sqlite3.connect((source / 'catalog.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    names = args.scene or [r['name'] for r in db.execute(
        'SELECT name FROM assets WHERE archive=? AND bucket=? AND instr(lower(name),?)>0 AND instr(lower(name),?)=0',
        ('data/data040.kom', 'scripts', 'pvp', 'linemap'))]
    def find(name):
        rows = list(db.execute('SELECT * FROM assets WHERE lower(name)=lower(?)', (name,)))
        if not rows or len(set(r['sha256'] for r in rows)) != 1:
            raise ValueError('Missing or ambiguous source: ' + name)
        return source / rows[0]['raw_path']
    for n in names:
        rec = recover(find(n).read_bytes())
        line_name = next(c['arguments'][0] for c in rec['calls'] if c['callee'] == 'SetLineMap')
        linemap = recover(find(line_name).read_bytes())
        lines = [c['arguments'][0] for c in linemap['calls'] if c['callee'] == 'AddLine_LUA']
        pts = [vector(l[key]) for l in lines for key in ('START_POS', 'END_POS')]
        refs = sorted(set(c['arguments'][0] for c in rec['calls']
                          if c['callee'] in ('SetXMesh', 'SetDomeMesh', 'SetXSkinMotion', 'AddXSkinModel')))
        row = {'name': n, 'methods': dict(collections.Counter(c['callee'] for c in rec['calls'])),
               'meshReferences': refs, 'lineMap': line_name, 'lineCount': len(lines),
               'lineTypes': dict(collections.Counter(display(l.get('LINE_TYPE')) for l in lines)),
               'elevations': sorted(set(p[1] for p in pts)),
               'zCoordinates': sorted(set(p[2] for p in pts)),
               'bounds': {'min': [min(p[i] for p in pts) for i in range(3)],
                          'max': [max(p[i] for p in pts) for i in range(3)]},
               'startMethods': dict(collections.Counter(c['callee'] for c in linemap['calls'])),
               'teamStarts': [c for c in linemap['calls'] if c['callee'] == 'SetTeamStartPos'],
               'cameraDeclarations': [c for c in rec['calls'] if 'Projection' in c['callee'] or 'Camera' in c['callee']]}
        print(json.dumps(row, ensure_ascii=False))


if __name__ == '__main__':
    main()
