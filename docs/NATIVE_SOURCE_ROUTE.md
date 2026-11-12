# Native modules

Selected source consumers compile to WebAssembly behind explicit host interfaces. Geometry, camera, commands, skills and other modules provide narrow functions used by the headless and browser runtimes. Their manifests record identities and dependencies.

Use a private source cache that matches the contracts. Set up the reference checkouts and an appropriate Zig executable, then build from the repository root.

```sh
python tools/native/build_runtime.py --zig <zig-executable> --source-cache .cache/native-source-runtime
```

Individual module builds support `--geometry-only`, `--commands-only` and `--skills-only`. Retain the hashes of unrelated modules and verify the resulting native manifest with the consuming runtime. Versioned reference code can establish the behavior of a compiled function under a harness. Independent target measurements are required to confirm the behavior of the full 2016 client.
