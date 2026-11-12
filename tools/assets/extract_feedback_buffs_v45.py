"""Extract original feedback buff identities/displays; inputs stay read-only."""
import json,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/combat')]
from build_rf import Catalog,digest
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable

def extract(source):
    catalog=Catalog(source)
    enums=EnumTable(read_declarations(catalog.path('Enum.lua'))['globals'])
    result={'schemaVersion':1,'targetVersion':'Steam-NA-2016-V6.0420.5',
            'targetClientMeasured':False,'scope':'original missing feedback buff identities; consumers and attack effects are separate',
            'buffTemplates':{},'buffFactors':{},'effectSets':{},'effectTemplates':{}}
    for group,name,ids,key in [('buffTemplates','BattleFieldBuffTemplet.lua',[433,438],'BUFF_TEMPLET_ID'),
                               ('buffFactors','BattleFieldBuffFactor.lua',[470,476],'BUFF_FACTOR_ID')]:
        file=catalog.path(name)
        data=read_declarations(file,enums,capture_calls=True,capture_unresolved=True)
        for call in data['nativeCalls']:
            raw=call['args'][-1]
            if not isinstance(raw,dict) or raw.get(key) not in ids:continue
            result[group][str(raw[key])]={'raw':raw['BUFF_FACTOR'] if group=='buffFactors' else raw,
              'sourcePc':{'prototype':call['prototype'],'instruction':call['instruction']},
              'source':{'name':name,'sha256':digest(file.read_bytes())}}
        if set(result[group])!={str(v) for v in ids}:raise ValueError('Missing original declarations')
    file=catalog.path('EffectSet.lua')
    data=read_declarations(file,enums,capture_calls=True,capture_unresolved=True)
    name='EffectSet_Moonlight_Rhapsody_Buff_Display'
    calls=[c for c in data['nativeCalls'] if c.get('target')=='g_pEffectSet.AddEffectSetTemplet_LUA'
           and len(c['args'])>1 and isinstance(c['args'][1],dict) and c['args'][1].get('NAME')==name]
    if len(calls)!=1:raise ValueError('Missing/ambiguous original Moonlight buff display')
    call=calls[0]
    result['effectSets'][name]={'raw':call['args'][1],
        'sourcePc':{'prototype':call['prototype'],'instruction':call['instruction']},
        'source':{'name':'EffectSet.lua','sha256':digest(file.read_bytes())}}
    return result

if __name__=='__main__':
    out=ROOT/'contracts/feedback-buff-closure-v45.json'
    out.write_text(json.dumps(extract(Path('asset_work')),ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print('Extracted original BF470/476, BT433/438 and Moonlight buff display; no source writes.')
