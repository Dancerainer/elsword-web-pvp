# Working on web pvp

- Read README.md, docs/DEVELOPMENT_PLAN.md and docs/SOURCES.md before starting. Obtain explicit scope before beginning a phase marked for review.
- Treat original clients, extracted upstream data and separate upstream checkouts as read-only. Give each task its own branch, worktree, generated outputs and caches.
- Commit source tools, configuration contracts, source hashes, small redistributable fixtures and reproducible tests. Keep client files, third-party source distributions, full extractions, private service configuration and build products outside Git.
- Use the North American client as the source for English display text. Keep text overrides independent of combat numbers, stable IDs and resource paths. Use the project name `web pvp`.
- Distinguish original configuration, versioned reference source, static inference, target-client measurements and simulation. Preserve unknown fields as unsupported. Keep independent original evidence separate from simulator output.
- Run combat independently of rendering and networking. Freeze the original baseline, profession preset and program version for a match. Given those versions, the same seed and inputs should reproduce the same outcome.
- Use the common behavior executor. Verify model conversion, original map layout and collision, and moving combat separately. A training lane cannot validate map collision. Derive clock rate, attributes and awakening from evidence for the intended mode.
- Test parser changes against real and damaged samples. Verify combat changes against relevant independent traces and regression cases. Check links, diffs and Git status for documentation changes.
- Install dependencies, start an original client or modify an upstream environment only within an explicitly authorized scope.
