"""Validate an explicitly selected physical, task-local regression output root."""
from pathlib import Path
import stat


def checked_output(output, source, task_root, output_root=None, label='Asset'):
    task_root = Path(task_root).resolve()
    output = Path(output).absolute()
    source = Path(source).resolve()
    if output_root is None:
        resolved = output.resolve()
        if not resolved.is_relative_to(task_root / 'artifacts') or resolved.is_relative_to(source):
            raise ValueError(label + " output must stay in this task's artifacts directory")
        return resolved
    root = Path(output_root).absolute()
    runtime = task_root / 'runtime'
    # The explicit root cannot redirect through a junction into a shared source.
    # Validate every existing ancestor, including the candidate output directory.
    if not root.is_relative_to(runtime) or root == runtime or root.resolve() != root:
        raise ValueError('Explicit output root must be a physical directory in this task runtime')
    for candidate in (root, output):
        if not candidate.is_relative_to(root) or candidate.resolve() != candidate:
            raise ValueError('Output escapes the explicit physical task root')
        for part in (candidate, *candidate.parents):
            if part.exists() and (part.is_symlink() or getattr(part.stat(), 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
                raise ValueError('Output root cannot contain a junction or symlink')
            if part == task_root:
                break
    if output.is_relative_to(source) or source.is_relative_to(root):
        raise ValueError('Output overlaps read-only source')
    return output
