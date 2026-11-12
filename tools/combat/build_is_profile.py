"""Build IS using the common Elsword source compiler and explicit IS bindings."""
from pathlib import Path
import argparse,json,hashlib
import is_definitions
from build_lk_profile import build,ROOT
if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,default=ROOT/'.cache/is-target')
    p.add_argument('--assets',type=Path,default=ROOT/'artifacts/is')
    p.add_argument('--output',type=Path,default=ROOT/'packages/combat-core/is-profile.json')
    a=p.parse_args();result=build(a.cache,a.assets,is_definitions)
    # Native callbacks create these names without a state declaration entry.
    # Prewarm must traverse their authored set/damage/mesh descendants too.
    result['sourceLiteralResources']=sorted(set(is_definitions.RESOURCE_ROOTS+is_definitions.VISUAL_ROOTS))
    limitations={
        'skill-traits':'MI_USEFUL additional-hit schedules and MI_CRITICAL defensive-effect bypasses remain partial; inspect each branch limitations',
        'consumer-version':'IS and common Elsword callbacks combine target declarations with qualified fixedV5 references and explicit target-description adapters; no matching target executable trace',
    }
    for row in result['unsupported']:
        if row['id'] in limitations:row['reason']=limitations[row['id']]
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'states':len(result['states']),'skills':len(result['skillCatalog']),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
