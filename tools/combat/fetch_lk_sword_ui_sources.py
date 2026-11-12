"""Acquire two bounded, pinned UI source files into this task's own cache."""
import base64
import os
import hashlib
import json
from pathlib import Path
import urllib.request
ROOT=Path(__file__).resolve().parents[2]
FILES={'KTDGUIControl.cpp':'73d6efcbbce8331b783a0a8c3a7dca43b237f139','KTDGUIControl.h':'8429e92202a03508eaa26d7d71ccd18f98a7f761'}
API = os.environ.get('WEB_PVP_REFERENCE_BLOB_URL')
for name,expected in FILES.items():
    output=ROOT/'.cache/sword-ui-v2/KTDXLIB'/name
    if output.is_file():data=output.read_bytes()
    else:
        if not API:
            raise ValueError('Set WEB_PVP_REFERENCE_BLOB_URL to the authorized reference blob API')
        with urllib.request.urlopen(API.rstrip('/') + '/' + expected,timeout=15) as response:payload=response.read(200001)
        if len(payload)>200000:raise ValueError('Bounded source response exceeded')
        data=base64.b64decode(json.loads(payload)['content'],validate=True)
    blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if blob!=expected:raise ValueError('Pinned UI Git blob mismatch')
    output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(data)
    print(name,hashlib.sha256(data).hexdigest())
