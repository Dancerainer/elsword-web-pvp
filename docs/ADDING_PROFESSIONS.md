# Add a profession

1. Identify the character and profession IDs, original state list, commands, skill declarations and resource dependencies. Record the target version and hashes. Mark uncertain fields and unimplemented consumers explicitly.
2. Build the profession profile and configuration preset. Keep stable skill IDs, original values and original paths independent of English labels. Register the profession in the shared catalog and define its eight-slot loadout.
3. Reuse the common behavior executor for movement, collision, costs, hits and state transitions. Add profession-specific logic only where the source identifies a different consumer. Freeze the preset and runtime version at match creation.
4. Convert the required meshes, animation, effects, audio and UI resources. Verify hashes, texture bindings and original map collision. Reuse verified resources across professions.
5. Test both directions, ground and air transitions, input windows, resource consumption, passive effects, death, respawn and replay. Add the profession to the lobby, practice, matchmaking, replication and presentation checks.
6. Measure cold loading and steady-state frame time on the same scenario. Compare with independent original traces when making a fidelity claim. Record surviving gaps and the full path required to reproduce them.
