"""Archive desktop runtime/content and verify every entry after compression."""
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

def archive(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists() or output.is_relative_to(source):
        raise ValueError('New archive outside source required')
    # Task worktrees and original long texture names can exceed MAX_PATH.
    # Python rglob otherwise silently omits those files on Windows even though
    # Node copied them. Extended paths keep the complete manifest enumerable.
    if os.name == 'nt' and not str(source).startswith('\\\\?\\'):
        source = Path('\\\\?\\' + str(source))
    manifest_bytes = (source / 'package-manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    expected = manifest['files']
    inputs = [p for p in source.rglob('*') if p.is_file()]
    if {p.relative_to(source).as_posix() for p in inputs} != set(expected) | {'package-manifest.json'}:
        raise ValueError('Unexpected or missing package files')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Package cannot contain links')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in sorted(inputs):
            z.write(file, source.name + '/' + file.relative_to(source).as_posix())
    with zipfile.ZipFile(output) as z:
        if len(z.infolist()) != len(inputs):
            raise ValueError('Entry count differs')
        for name, expected_hash in expected.items():
            digest = hashlib.sha256()
            with z.open(source.name + '/' + name) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            if digest.hexdigest() != expected_hash:
                raise ValueError('ZIP hash mismatch: ' + name)
        if z.read(source.name + '/package-manifest.json') != manifest_bytes:
            raise ValueError('ZIP manifest mismatch')
    digest = hashlib.sha256()
    with output.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    result = dict(archive=str(output), bytes=output.stat().st_size, files=len(inputs),
                  sha256=digest.hexdigest(), allArchiveHashesVerified=True,
                  contentReleaseId=manifest['contentReleaseId'], buildSha256=manifest['buildSha256'])
    output.with_suffix('.sha256.txt').write_text(digest.hexdigest()+'  '+output.name+'\n',encoding='utf-8')
    output.with_suffix('.verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return result

if __name__ == '__main__':
    print(json.dumps(archive(*sys.argv[1:])))
