# Minimal input and movement runtime

The isolated RF experiment uses the original stage collision, RF model and motion. It handles movement, dash, jump, falling and an initial ground attack. The host supplies timestamps, virtual keys and a bounded input queue. Native reference consumers handle the selected input and movement states.

The experiment is deliberately scoped to the input and movement boundary. The main combat executor still supplies state entry, hit handling and reactions. Use the [runtime contract](../contracts/rf-minimal-runtime-v1.json) when changing host interfaces. Test deterministic input timing separately from visual motion or network behavior.
