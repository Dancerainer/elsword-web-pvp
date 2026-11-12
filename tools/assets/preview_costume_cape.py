"""CPU source-surface diagnostic, NOT a browser or original-client capture."""
import json
import math
from pathlib import Path
from build_costumes import ROOT, Catalog, Exporter, load_x
from export_samples import render

def main():
    catalog=Catalog('asset_work')
    output=ROOT/'runtime/costume-review-v2';output.mkdir(parents=True,exist_ok=True)
    samples=[]
    for character,item in [('Elsword',130646),('Raven',130649)]:
        for mode,prefix in [('normal',''),('awakened','Hyper_')]:
            source=catalog.path(f'{prefix}Mesh_{character}_AC_Upbody_{item}_Sorted.X')
            exporter=Exporter('cape',texture_lookup=catalog,asset_root=catalog.root)
            exporter.add(source,output,tree=load_x(source),clips_override=[])
            for side,yaw in [('front',0),('back',math.pi)]:
                for cull in [False,True]:
                    exporter.name=f'{character}_{mode}_{side}_{"culled" if cull else "two-sided"}'
                    render(exporter,output,'CPU bind-pose source surfaces; not GPU/client capture',yaw=yaw,cull_back=cull)
                    samples.append({'name':exporter.name,'source':catalog.evidence(source),'cullBack':cull,'yaw':yaw})
    (output/'samples.json').write_text(json.dumps(samples,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'images':len(samples),'output':str(output),'evidence':'CPU source geometry'}))

if __name__=='__main__':main()
