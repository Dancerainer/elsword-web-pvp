"""Read two original LK charge declarations without executing client code."""
import hashlib
import json
from pathlib import Path
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable

root = Path(__file__).resolve().parents[2]
source = Path('asset_work/raw/data/data036.kom')
hashes = {
    'Enum.lua': 'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6',
    'Elsword_SwordMan.lua': '743fc48b74fd35ed69a2e8573acd2d7759d3005340ff4e1655c0678dbf741031',
}
for name, expected in hashes.items():
    assert hashlib.sha256((source / name).read_bytes()).hexdigest() == expected, name
enum = read_declarations(source / 'Enum.lua', capture_calls=False, capture_unresolved=True)
unit = read_declarations(source / 'Elsword_SwordMan.lua', EnumTable(enum['globals']), capture_calls=False, capture_unresolved=True)
names = ['ESSI_ESK_DASH_COMBO_ZChargeX', 'ESSI_ELK_DASH_COMBO_XChargeX']
rows = {name: unit['globals'][name] for name in names}
for name, raw in rows.items():
    assert raw['CAN_MANA_BREAK'] == 0, name
output = root / '.cache/common-charge-standup-v8'
output.mkdir(parents=True, exist_ok=True)
(output / 'elsword-charge-rows.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', 'utf8')
print(json.dumps({'originalRows': len(rows), 'sourceHashesVerified': len(hashes)}))
