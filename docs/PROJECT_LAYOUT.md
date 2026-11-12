# Project layout

| Directory | Responsibility |
| --- | --- |
| `apps/web` | Login page, lobby, combat presentation and browser network integration |
| `apps/server` | HTTP server, account sessions, rooms, matchmaking and update delivery |
| `apps/local-client`, `apps/desktop` | Portable resource proxy and Windows desktop shell |
| `apps/minimal`, `packages/minimal-runtime` | Isolated input and movement experiment |
| `packages/combat-core`, `packages/pvp` | Headless combat, profession profiles and match rules |
| `packages/online` | Online protocol, ownership, scheduling and codecs |
| `packages/localization`, `packages/professions` | Player-facing text and profession registry |
| `config`, `contracts` | Presets, evidence classifications and versioned data contracts |
| `tools`, `scripts` | Converters, native build tools, checks, server and client packaging |
| `tests` | Unit, combat, integration, network, UI and source checks |

`asset_work/` and `asset_sources/` hold private inputs. `artifacts/` holds generated runtime resources, `dist/` holds web bundles, and `runtime/` holds local accounts, settings, logs and packages. Generate outputs in the task's own worktree.
