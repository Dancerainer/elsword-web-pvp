"""Convert complete original ADD FX closure and preserve source versus presentation budgets."""
import argparse,json,sys,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import write_json,Catalog,digest
from build_rf_fx import declaration
from build_lk_fx import build as build_fx
from lk_skill_ui import build as build_ui
import audio
JOBS={'lp':(122,81),'mm':(123,82),'de':(126,86)}
def build(job,profile_root,mode='all'):
    profile=profile_root/f'{job}-profile.json';source=Path('asset_work');out=ROOT/'artifacts'/job
    if mode in ('all','fx'):
        shared=[]
        for old in ('rf','lk','vc','rs','bm','is','lp','mm'):
            if old==job:break
            shared += [(p,f'../{old}/')for p in sorted((ROOT/'artifacts'/old).glob('*/index.json')) if 'templates' in json.loads(p.read_text('utf8'))]
        c=Catalog(source);minor=c.path('GameMinorParticle.txt');text=minor.read_bytes().decode('latin1')
        literals=json.loads(profile.read_text('utf8')).get('sourceLiteralResources',[])
        text_literals=json.dumps(literals);extras={}
        for match in re.finditer(r'eventsequence\s+"([^"\r\n]+)"\s*\{([^{}]*)\}',text):
            name=match[1]
            if name!='UnitPressed' and not (name.startswith('ADD_STR_') and name in text_literals):continue
            row=declaration(match[2],casefold_tokens=True)
            if row['unsupported']:raise ValueError('Unsupported explicit ADD minor source '+name)
            row.update(name=name,kind='particle',sourceFamily='game-minor',source={**c.evidence(minor),'byteOffset':match.start(),'line':text.count('\n',0,match.start())+1},declarationSha256=digest(match[0].encode('latin1')))
            extras[name]=row
        index=build_fx(out/'fx',profile,source,ROOT/f'contracts/{job}-fx-index.json',shared_indexes=shared,additional_definitions=extras,presentation_roots=tuple(extras))
    if mode in ('all','ui'):
        cls,atlas=JOBS[job];prefix='ADD_A'+job.upper()
        build_ui(source,ROOT/'artifacts/ui/skills'/job,profile,out/'ui',profession_id=job,unit_class=cls,
                 portrait_atlas=f'DLG_UI_Common_Texture{atlas}_NEW',portrait_prefix=prefix,portrait_pieces={'STATE':prefix+'_FACE'})
    if mode in ('all','audio'):
        audio.VERSION='add-audio-target2016-v1'
        try:m=audio.build(profile,source,out/'audio',ROOT/f'reports/{job}-audio.json')
        except ValueError as error:
            if str(error)!='Referenced audio dependencies remain unsupported; see report':raise
            m=json.loads((out/'audio/manifest.json').read_text('utf8'))
            if any(row['reason']!='missing/ambiguous original catalog entry' for row in m['unsupported']):raise
            m['limits'].append('Missing source names remain unsupported and silent; no guessed replacement audio.')
        for row in m['files'].values():row['file']=f'../{job}/audio/'+row['file']
        write_json(out/'audio/manifest.json',m)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--job',choices=JOBS);p.add_argument('--profile-root',type=Path,default=ROOT/'packages/combat-core');p.add_argument('--mode',choices=['all','fx','ui','audio'],default='all');a=p.parse_args()
    for job in ([a.job]if a.job else JOBS):build(job,a.profile_root,a.mode)
