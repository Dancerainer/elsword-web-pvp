"""Select private regression evidence without changing the public asset closure."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[3]


def evidence_path(relative):
    root = Path(os.environ.get('RF_ASSET_REGRESSION_ROOT', ROOT)).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Private regression evidence escapes selected root')
    return path


def native_repo(test, request_name, manifest_name):
    """Use tracked receipts and independently hashed ignored key bytes."""
    (ROOT / 'runtime').mkdir(exist_ok=True)
    temporary = tempfile.TemporaryDirectory(prefix='native-evidence-test-', dir=ROOT / 'runtime')
    test.addCleanup(temporary.cleanup)
    repo = Path(temporary.name)
    manifest_bytes = (ROOT / manifest_name).read_bytes()
    manifest = json.loads(manifest_bytes)
    entry = manifest['artifact']
    keys = evidence_path(entry['path']).read_bytes()
    if len(keys) != entry['bytes'] or hashlib.sha256(keys).hexdigest() != entry['sha256']:
        raise ValueError('Selected private native proof hash/size mismatch')
    for relative, data in ((request_name, (ROOT / request_name).read_bytes()),
            (manifest_name, manifest_bytes), (entry['path'], keys)):
        path = repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return repo
