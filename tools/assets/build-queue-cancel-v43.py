"""Extract the original match-failure cue for the user-requested cancel action."""
import hashlib
import json
import sqlite3
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'asset_work'

def build():
    connection = sqlite3.connect((SOURCE/'catalog.sqlite').as_uri()+'?mode=ro',uri=True)
    connection.row_factory = sqlite3.Row
    rows = list(connection.execute("SELECT * FROM assets WHERE status='ok' AND name='Battle_Atena_Fail.ogg' ORDER BY archive,ordinal"))
    if not rows or len({row['sha256'] for row in rows}) != 1:
        raise ValueError('Missing or ambiguous original queue failure cue')
    row = rows[0]
    source = (SOURCE/row['raw_path']).resolve()
    if not source.is_relative_to(SOURCE/'raw'):
        raise ValueError('Source escaped read-only extraction root')
    blob = source.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != row['sha256'].lower() or not blob.startswith(b'OggS'):
        raise ValueError('Original cue corrupt')
    pos = blob.index(b'\x01vorbis')
    rate = struct.unpack_from('<I',blob,pos+12)[0]
    samples = struct.unpack_from('<Q',blob,blob.rfind(b'OggS')+6)[0]
    record = {'file':'feedback-v26/Battle_Atena_Fail.ogg','sha256':digest,'durationSeconds':samples/rate,
              'source':{'archive':row['archive'],'ordinal':row['ordinal'],'name':row['name'],
                        'rawPath':row['raw_path'],'sha256':digest,'bytes':len(blob),'signatureHex':blob[:16].hex()}}
    output = ROOT/'runtime/feedback-v43/assets/audio/feedback-v26'
    manifest = json.loads((output/'manifest.json').read_text('utf-8'))
    manifest['files']['Battle_Atena_Fail.ogg'] = record
    (output/'Battle_Atena_Fail.ogg').write_bytes(blob)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n','utf-8')
    contract = {'schemaVersion':1,'originalClientMeasured':False,'files':{'Battle_Atena_Fail.ogg':record},
                'cuePolicy':'User-authorized Web queue cancellation binding after successful DELETE; target original Battle_Atena_Fail asset, not a measured original cancellation trigger.'}
    (ROOT/'contracts/queue-cancel-audio-v43.json').write_text(json.dumps(contract,indent=2)+'\n','utf-8')
    print(json.dumps({'file':record['file'],'sha256':digest,'bytes':len(blob)}))

if __name__ == '__main__':
    build()
