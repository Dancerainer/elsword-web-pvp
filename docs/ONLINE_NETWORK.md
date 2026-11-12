# Online rooms and combat

The server authenticates accounts, locks the selected professions and rules at match creation, assigns players, tracks scores and ends the match. Login, queue, loading and match activity belong to a session. Session generation and sequence checks prevent a retired page or stale network message from taking over an active player.

In owner-driven mode each player advances local movement and combat. Peers receive position samples, actions and hit records. The WebRTC path carries peer updates when available. WebSocket, SSE or HTTP transports provide server upload, control and fallback delivery. Preserve the original actor and action identities across transports so retries can be deduplicated.

A peer connection negotiates through the server, then exchanges control events and pose samples. Configure `RF_RTC_ICE_SERVERS` on the server with a JSON array of ICE server settings for the deployment. The default list is empty; a deployment must supply its own STUN or TURN server if needed. `RF_NETWORK_PEER_MODE` accepts `hybrid` (the default) or `relay`. In relay mode, the application uses the server relay instead of creating peer connections. The server relay is distinct from a TURN service. See [server setup](PUBLIC_ONLINE.md).

Reliable actions and lifecycle transitions must arrive in causal order. Motion samples can supersede older samples where the protocol permits it. Apply acknowledgments to the correct stream and life. Enforce bounded queues and resynchronize when the receiver lacks the baseline needed to decode a delta.

To validate a change, run the same inputs under direct and relayed transport, delayed or reordered motion, lost packets, disconnect and reconnect. Check remote motion separately from actual hits, score, restored state and return to the lobby. Record bytes, latency and the test conditions. A loopback or simulated delay is evidence for those conditions only.
