"""Archive an isolated client package and recheck every included byte against its manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def archive(source, output):
    source = source.resolve()
    output = output.resolve()
    if output.is_relative_to(source) or output.exists():
        raise ValueError('Archive must be new and separate from package contents')
    manifest = json.loads((source / 'client-manifest.json').read_text(encoding='utf-8'))
    expected = manifest['files']
    inputs = [p for p in source.rglob('*') if p.is_file()]
    # The operator may edit the endpoint without changing the payload manifest.
    if (source / 'server-config.json').exists():
        expected = {**expected, 'server-config.json': hashlib.sha256((source / 'server-config.json').read_bytes()).hexdigest()}
    names = {p.relative_to(source).as_posix() for p in inputs}
    if names != set(expected) | {'client-manifest.json'}:
        raise ValueError('Unexpected file in client package')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Client package must not contain links')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as result:
        for file in sorted(inputs):
            result.write(file, source.name + '/' + file.relative_to(source).as_posix())
    with zipfile.ZipFile(output) as result:
        if len(result.infolist()) != len(inputs):
            raise ValueError('Archive file count differs')
        for name, digest in expected.items():
            computed = hashlib.sha256()
            with result.open(source.name + '/' + name) as entry:
                while chunk := entry.read(1024 * 1024):
                    computed.update(chunk)
            if computed.hexdigest() != digest:
                raise ValueError('Archived byte hash differs: ' + name)
        if result.read(source.name + '/client-manifest.json') != (source / 'client-manifest.json').read_bytes():
            raise ValueError('Archived manifest differs')
    computed = hashlib.sha256()
    with output.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            computed.update(chunk)
    summary = {'schemaVersion': 1, 'archive': str(output), 'bytes': output.stat().st_size,
               'sha256': computed.hexdigest(), 'files': len(inputs), 'allArchiveHashesVerified': True}
    output.with_suffix('.sha256.txt').write_text(computed.hexdigest() + '  ' + output.name + '\n', encoding='utf-8')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(archive(args.source, args.output)))
