# Respawn resources

The match reads the score difference when the player respawns. A tied or trailing team keeps 100% of eligible resources. A team leading by one keeps 50%, and a lead of two or more retains 0%. Apply the adjustment once when rebuilding the actor. Opening grants belong only to initial spawn.

MP uses the reference seasonal respawn branch. Applying the percentage to explicitly registered profession pools is a web match rule. Preserve awakening beads and charge separately. Active awakening time and Raven's core gauges follow their own respawn lifecycle.

Register a special pool by a unique stable ID and deterministic synchronous read/write callbacks. Return null for an unsupported actor. Include the pool IDs in snapshots and require a matching registry on restore. See the [resource contract](../contracts/rf-pvp-resources-source-v3.json) and the [match rule contract](../contracts/rf-pvp-rules-source-v1.json).
