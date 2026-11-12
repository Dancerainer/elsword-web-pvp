"""Read the three Add careers from original, hash-checked target declarations."""
import argparse
from pathlib import Path
from prepare_lk_declarations import prepare,NAMES
ADD_NAMES={'enum':'Enum.lua','add':'Add_NasodRuler.lua',**{k:v for k,v in NAMES.items() if k not in ('enum','elsword','way-of-sword')}}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,default=Path('asset_work'));p.add_argument('--output',type=Path,default=Path('.cache/add-target'));a=p.parse_args();prepare(a.source_root,a.output,ADD_NAMES,('add',))
 prepare(a.source_root,a.output.parent/'add-npc',{'enum':'Enum.lua','apocalypse':'SI_HA_APOCALYPSE.lua','npcs':'NPCTemplet.lua'},('apocalypse',))
