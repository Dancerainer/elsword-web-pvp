"""Fetch four pinned clock files via bounded read-only HTTP, never clone or write upstream."""
import argparse
import base64
import os
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
API = os.environ.get('WEB_PVP_REFERENCE_BLOB_URL')
FILES = {
    'KTDXLIB/KTDXApp.cpp': 'b0118343485aa657194ab97a2eef9b81639abd3c',
    'X2Lib/X2Main.cpp': '47bc0f8ead8456572a3b7c573151606dae556d64',
    'X2Lib/X2GameOption.cpp': '6326535c3fb819ec4af447d734ca94d9f4f8a15b',
    'X2/KOGGamePerformanceCheckDefine.h': '7b14aae19c5f637272f63696e2a144f39019e69a',
}


def blob_id(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    results = []
    for name, expected in FILES.items():
        path = ROOT / '.cache/clock-source-v16' / name
        if path.is_file():
            data = path.read_bytes()
        elif args.check_only:
            raise FileNotFoundError(path)
        else:
            if time.monotonic() - started >= 300:
                raise TimeoutError('Five-minute acquisition bound exceeded')
            if not API:
                raise ValueError('Set WEB_PVP_REFERENCE_BLOB_URL to the authorized reference blob API')
            request = urllib.request.Request(API.rstrip('/') + '/' + expected, headers={'User-Agent': 'rf-v16-source-audit'})
            with urllib.request.urlopen(request, timeout=12) as response:
                # Each source file is < 1 MiB; bound the response before decoding.
                payload = response.read(2 * 1024 * 1024 + 1)
            if len(payload) > 2 * 1024 * 1024:
                raise ValueError('Unexpectedly large source response: ' + name)
            data = base64.b64decode(json.loads(payload)['content'], validate=True)
            if blob_id(data) != expected:
                raise ValueError('Pinned Git blob mismatch: ' + name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if blob_id(data) != expected:
            raise ValueError('Pinned cached Git blob mismatch: ' + name)
        results.append({'repositoryPath': 'JP_TW_EU_CN_US/Trunk/' + name,
                        'gitBlob': expected, 'bytes': len(data),
                        'sha256': hashlib.sha256(data).hexdigest()})
    print(json.dumps({'referenceCommit': COMMIT, 'checkOnly': args.check_only,
                      'verifiedFiles': results}, indent=2))


if __name__ == '__main__':
    main()
