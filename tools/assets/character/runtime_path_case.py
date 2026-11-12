"""Keep consumer references portable without renaming shared asset bytes.

Do not use Path.resolve for the input: Windows resolves the actual spelling
before comparison and can hide precisely the case mismatch being audited.
"""
import os
from pathlib import Path


def canonical_runtime_path(base, reference):
    base = Path(os.path.abspath(base))
    if not isinstance(reference, str) or not reference or Path(reference).is_absolute():
        raise ValueError('Relative runtime asset path required')
    requested = Path(os.path.abspath(base / reference))
    current = Path(requested.anchor)
    for part in requested.parts[1:]:
        entries = {entry.name: entry for entry in current.iterdir()}
        exact = entries.get(part)
        if exact is None:
            candidates = [entry for name, entry in entries.items() if name.casefold() == part.casefold()]
            if len(candidates) != 1:
                raise ValueError('Missing or ambiguous runtime asset path: ' + str(requested))
            exact = candidates[0]
        current = exact
    if not current.is_file():
        raise ValueError('Runtime asset path is not a file: ' + str(current))
    return Path(os.path.relpath(current, base)).as_posix()


def canonicalize_effect_paths(index, base):
    changes = []
    for name, template in index['templates'].items():
        values = [(template, key) for key in ('glb', 'poseData') if template.get(key)]
        values += [(row, 'file') for row in template.get('textures', {}).values()]
        for row, key in values:
            original = row[key]
            corrected = canonical_runtime_path(base, original)
            if corrected != original:
                row[key] = corrected
                changes.append({'template': name, 'field': key, 'before': original, 'after': corrected})
    return changes
