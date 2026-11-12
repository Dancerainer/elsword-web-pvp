# Source inputs and evidence

| Input | Use |
| --- | --- |
| North American 2016 client | Target declarations, skill IDs, English display text, animation, collision, effects, models and audio. |
| Versioned reference source | Explains data structures and selected consumers. Record the revision, file hash, function and any host adaptation. |
| Static executable analysis | Supports claims about a particular binary's instructions and data flow. Record the input hash and the limits of the analysis. |
| Target-client trace | Independent evidence of a particular input, state transition, contact or timing under specified conditions. |
| Web simulation and browser tests | Verify the current implementation under controlled inputs, renderers and network conditions. |

Keep the original installation and upstream references read-only. For a local conversion, place an extracted asset workspace with its catalog at `asset_work/`, or pass the converter's source argument. Keep reference source under a private cache and write derived runtime data to `artifacts/`. For a prepared resource tree, point the server at its root with `RF_ASSET_ROOT`. Required directories include the character and scene manifests, UI atlases, audio and the native manifest and modules referenced by it.

```powershell
./scripts/build-assets.ps1 -Source ./asset_work
```

To copy prepared runtime resources from another read-only project tree, use `node tools/prepare-online.mjs <project-directory>`. The input must contain an `artifacts/` directory.

The PowerShell conversion script rebuilds the RF resource slice. Other professions and complete client packaging require their respective inputs and manifests. Record the container, entry, SHA-256, converter version, dependencies and output digest for each derived resource. The selected static contracts in `contracts/` preserve source identifiers and hashes. Some cite privately held evidence by logical name. Obtain the corresponding inputs independently to reproduce those checks.

Paths under `reports/analysis/` in the contracts and source tools are logical names for private evidence. When a separately obtained evidence archive uses a different directory layout, prepare a task-local copy or mapping with these names; do not rename or modify the original archive or its checkout. The pinned Git-object reader resolves its report by a unique suffix in the specified commit.

Use original English player text when available and label project-authored cues separately. Never derive combat values from localized UI text or regenerate an original expectation from a web run.
