"""Convert only the source-hashed original Chaser trail DDS into a private output.
Does not modify raw/client/shared caches. Caller copies the one output into its
release artifacts/mm only after review; no engine or Lua execution.
"""
from pathlib import Path
import argparse,json,hashlib
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
 c=json.loads((ROOT/'contracts/mm-chaser-trail-v61.json').read_text(encoding='utf-8'));src=Path('asset_work/raw')/c['texture']['source'];b=src.read_bytes()
 assert hashlib.sha256(b).hexdigest()==c['texture']['sha256']
 out=args.output.resolve()/c['texture']['file'];out.parent.mkdir(parents=True,exist_ok=True);im=Image.open(src);assert [im.width,im.height]==[c['texture']['width'],c['texture']['height']];im.save(out)
 assert hashlib.sha256(out.read_bytes()).hexdigest()==c['texture']['pngSha256'];print(json.dumps({'path':str(out),'sha256':c['texture']['pngSha256'],'bytes':out.stat().st_size}))
if __name__=='__main__':main()
