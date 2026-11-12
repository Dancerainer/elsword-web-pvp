"""Copy exact target2016 LK sound dependencies and validate Ogg/Vorbis bytes."""
import argparse
from pathlib import Path
import audio

ROOT=Path(__file__).resolve().parents[2]

def build(profile,source,output,report,reference=ROOT/'contracts/lk-native-sound-triggers-v2.json'):
    # Shared decoder validates source/copy SHA, all Ogg pages and their CRC.
    # SwordMan hard-coded calls keep their fixed-V5 evidence classification.
    audio.VERSION='lk-audio-target2016-v1'
    manifest=audio.build(profile,source,output,report,reference)
    for row in manifest['files'].values():
        row['file']='../lk/audio/'+row['file']
    manifest['assetBaseEvidence']='existing audio player uses /assets/audio/; LK paths resolve to /assets/lk/audio/'
    audio.write_json(output/'manifest.json',manifest)
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--profile',type=Path,default=ROOT/'packages/combat-core/lk-profile.json')
    p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/lk/audio')
    p.add_argument('--report',type=Path,default=ROOT/'reports/lk-audio.json')
    a=p.parse_args();build(a.profile,a.source_root,a.output,a.report)
