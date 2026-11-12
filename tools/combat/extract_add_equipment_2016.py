"""Extract Add-only rows from original KIM208 and CharacterStatTable inputs."""
import argparse,hashlib,json,sqlite3
from pathlib import Path
from kl82_static import read_declarations
from extract_equipment_2016 import Kim208,FIELDS
ROOT=Path(__file__).resolve().parents[2]
def extract(source):
 source=source.resolve()
 with sqlite3.connect((source/'catalog.sqlite').as_uri()+'?mode=ro',uri=True) as c:
  paths={}
  for name in ('CharacterStatTable.lua','item.kim','Enum.lua'):
   rows=list(c.execute('select raw_path,sha256 from assets where status=? and name=? collate nocase',('ok',name)))
   if not rows or len({r[1] for r in rows})!=1:raise ValueError('Ambiguous original source '+name)
   p=source/rows[0][0]
   if hashlib.sha256(p.read_bytes()).hexdigest()!=rows[0][1]:raise ValueError('Original SHA mismatch '+name)
   paths[name]=p
 stat=read_declarations(paths['CharacterStatTable.lua'])['globals'];kim=Kim208(paths['item.kim'].read_bytes())
 def rows(table,prefix):return {r[1]['$symbol'].split('.')[-1]:dict(zip(FIELDS,[r[n] for n in (6,2,4,3,5)])) for r in stat[table].values() if r[1]['$symbol'].split('.')[-1].startswith(prefix)}
 items={str(sid):kim.item(sid) for sid in (30412,30531)}
 if any(i['unitType']!=9 or i['grade']!=6 or i['slot']!=2 for i in items.values()):raise ValueError('Add weapon source mismatch')
 return dict(schemaVersion=1,evidenceClass='static-target2016-config',sourceBuild='NA2016 V6.0420.5',inputs={n:dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for n,p in paths.items()},character=rows('CHARACTER_RELATIVE_STAT_TABLE','UT_ADD'),career=rows('SECOND_CLASS_RELATIVE_STAT_TABLE','UC_ADD_'),items=items,kimLayout=dict(recordSize=208,indexedRecords=kim.count,allRecordIdsMatch=True),exclusions=['consumer formulas inherited as qualified fixedV5 candidate','no target2016 server or client run'])
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,default=Path('asset_work'));p.add_argument('--output',type=Path,default=ROOT/'contracts/add-equipment-2016-source-v1.json');a=p.parse_args();r=extract(a.source_root);a.output.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n','utf8')
