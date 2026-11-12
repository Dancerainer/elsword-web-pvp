"""Create a verified overwrite patch for an existing portable resource client.

Both input packages stay read-only. Every file in the target manifest must come
from the verified base or the verified ZIP; unused old files are never served
because the client uses the new manifest as its allowlist.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def sha(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def safe(name):
    return (isinstance(name, str) and not any(c in name for c in '\\:\0')
            and all(part and part not in ('.', '..') for part in name.split('/')))


def package(root):
    root = root.resolve()
    manifest_file = root / 'client-manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'), dict) \
            or not isinstance(manifest.get('assets'), dict):
        raise ValueError('Invalid client manifest')
    files = manifest['files']
    for name, digest in files.items():
        if not safe(name) or not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('Invalid client file')
        file = root / name
        if not file.is_file() or any(p.is_symlink() for p in [file, *file.parents] if p != root.parent):
            raise ValueError('Missing or linked client file: ' + name)
        if sha(file) != digest:
            raise ValueError('Client file hash mismatch: ' + name)
    for name, digest in manifest['assets'].items():
        if not safe(name) or files.get('assets/' + name) != digest:
            raise ValueError('Invalid client asset')
    if files.get('dist/game.js') != manifest.get('buildSha256'):
        raise ValueError('Invalid client build')
    return root, manifest, manifest_file.read_bytes()


def create_delta(base_root, current_root, output, base_label='elsword-six-professions-local-client-v1.zip'):
    base_root, before, _ = package(base_root)
    current_root, after, manifest_bytes = package(current_root)
    output = output.resolve()
    if output.exists() or output.is_relative_to(base_root) or output.is_relative_to(current_root):
        raise ValueError('Patch must be new and separate from both input packages')
    if before.get('remoteOrigin') != after.get('remoteOrigin'):
        raise ValueError('Patch cannot change remote server')
    changed = sorted(name for name, digest in after['files'].items()
                     if before['files'].get(name) != digest)
    unchanged = sorted(set(after['files']) - set(changed))
    guide = ('web pvp client update\r\n\r\n'
             'Base package: ' + base_label + '\r\n'
             '1. Close the launcher.\r\n'
             '2. Extract this patch into the folder containing Start-Client.bat and replace existing files.\r\n'
             '3. Run Start-Client.bat and wait for verification before signing in.\r\n'
             'Build: ' + after['buildSha256'] + '\r\n').encode('utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in changed:
            archive.write(current_root / name, name)
        archive.writestr('client-manifest.json', manifest_bytes)
        archive.writestr('UPDATE-GUIDE.txt', guide)
    with zipfile.ZipFile(output) as archive:
        if set(archive.namelist()) != set(changed) | {'client-manifest.json', 'UPDATE-GUIDE.txt'}:
            raise ValueError('Unexpected patch entry')
        if archive.read('client-manifest.json') != manifest_bytes:
            raise ValueError('Patch manifest differs')
        for name, digest in after['files'].items():
            if name in unchanged:
                actual = sha(base_root / name)
            else:
                value = hashlib.sha256()
                with archive.open(name) as stream:
                    while chunk := stream.read(1024 * 1024):
                        value.update(chunk)
                actual = value.hexdigest()
            if actual != digest:
                raise ValueError('Patched client file hash mismatch: ' + name)
    result = {'schemaVersion': 2, 'archive': str(output), 'bytes': output.stat().st_size,
              'sha256': sha(output), 'baseCommit': before.get('sourceCommit'),
              'sourceCommit': after.get('sourceCommit'), 'baseBuildSha256': before['buildSha256'],
              'buildSha256': after['buildSha256'], 'assetCount': len(after['assets']),
              'changedFiles': changed, 'changedFileCount': len(changed),
              'unchangedFileCount': len(unchanged),
              'addedFiles': [name for name in changed if name not in before['files']],
              'obsoleteFiles': sorted(set(before['files']) - set(after['files'])),
              'allTargetFilesVerifiedAgainstBaseAndZip': True,
              'inputsModified': False, 'nodeRuntimeIncluded': 'runtime/node.exe' in changed}
    output.with_suffix('.sha256.txt').write_text(result['sha256'] + '  ' + output.name + '\n', encoding='ascii')
    output.with_suffix('.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('current', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--base-label', default='elsword-six-professions-local-client-v1.zip')
    args = parser.parse_args()
    result = create_delta(args.base, args.current, args.output, args.base_label)
    print(json.dumps({key: value for key, value in result.items()
                      if key not in ('changedFiles', 'addedFiles', 'obsoleteFiles')}, ensure_ascii=False))
