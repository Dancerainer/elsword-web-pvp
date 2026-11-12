# Development and acceptance

The target is the 2016 North American client. Each match freezes the original data baseline, profession preset and program version. The repository implements a web simulation, a practice mode and online rooms. Fidelity remains open wherever a comparable target-client trace is missing.

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| M0 | Baseline and input inventory | Identify version, files, hashes, stable IDs and permitted reference sources. |
| M1 | Models, animations, effects and maps | Check converted geometry and animation independently. Verify collision, slopes, platforms and spawn positions against the real stage. |
| M2 | Shared behavior executor | Decode supported state transitions and callbacks. Record timing, costs, hit boxes and unsupported fields. Keep reference-derived behavior distinguishable from target data. |
| M3 | Deterministic combat | Replay specified input and seed without a renderer or network. Compare with an independently recorded target trace, locate the first divergence and verify the fix. |
| M4 | Network play | Freeze the same rules at every peer. Verify authority, recovery, match results, bounded queues and behavior during loss, stalls and reconnects. |

Before adding a profession, agree on the target states, skills and maps. Keep each conversion or runtime change independently testable. Skills with incomplete execution paths must report their limitations. A runtime test, reference-source probe, visual inspection and target-client comparison answer different questions. Record which one was performed.
