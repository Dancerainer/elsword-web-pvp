"""Finalize VC using the shared manifest/pose coverage validator."""
import json,sys,subprocess
from pathlib import Path
from finalize_lk_assets import finalize,write_json
ROOT=Path(__file__).resolve().parents[2]

def main():
    output=ROOT/'artifacts/vc'
    manifest=json.loads((output/'manifest.json').read_text('utf8'))
    rf=json.loads((ROOT/'artifacts/rf/manifest.json').read_text('utf8'))
    manifest['unitClass']=115
    core=dict(rf['mechanismResources']['ravenNasodCore'])
    core['glb']='../rf/'+core['glb']
    manifest['mechanismResources']={'ravenNasodCore':core}
    write_json(output/'manifest.json',manifest)
    finalize(output,ROOT/'packages/combat-core/vc-profile.json','vc',('Bip01_L_Hand','Bip01_L_Forearm','Dummy2_Lhand'))
    from pack_vc_runtime import pack
    reuse=pack()
    sys.path.insert(0,str(ROOT/'tools/combat'))
    from build_vc_profile import build
    from build_rf import digest
    profile=ROOT/'packages/combat-core/vc-profile.json'
    write_json(profile,build(ROOT/'.cache/vc',output))
    profile_sha=digest(profile.read_bytes())
    manifest=json.loads((output/'manifest.json').read_text('utf8'))
    manifest['profile']['sha256']=profile_sha;write_json(output/'manifest.json',manifest)
    fx=json.loads((output/'fx/index.json').read_text('utf8'));fx['profileSha256']=profile_sha
    write_json(output/'fx/index.json',fx);write_json(ROOT/'contracts/vc-fx-index.json',fx)
    subprocess.check_call(['node',str(ROOT/'tools/assets/normalize-vc-path-case.mjs')],cwd=ROOT)
    for row in reuse['outputs']:
        data=(output/row['file']).read_bytes();row.update(sha256=digest(data),bytes=len(data))
    reuse['runtimeBytes']=sum(row['bytes'] for row in reuse['outputs'])
    write_json(ROOT/'reports/vc-resource-reuse-v1.json',reuse)
    report=json.loads((ROOT/'reports/vc-assets-runtime.json').read_text('utf8'))
    report.update(outputs=reuse['outputs'],profile=manifest['profile'])
    report['summary'].update(files=len(reuse['outputs']),bytes=reuse['runtimeBytes'])
    write_json(ROOT/'reports/vc-assets-runtime.json',report)

if __name__=='__main__':main()
