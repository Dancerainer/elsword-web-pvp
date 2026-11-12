# Portable client

The portable Windows client combines a local asset pack, a bundled Node runtime and a loopback proxy. `Start-Client.bat` checks for updates and opens the game in a WebGL-capable browser. The endpoint used for login, matches and updates comes from the client settings. See the [player guide](LOCAL_CLIENT_PLAYER.txt).

## Build a package

Build the web bundle and prepare a deployment manifest for the matching source and asset tree. Run the packager in the repository root. Give it a new destination under `runtime/`.

```sh
node tools/package-local-client.mjs <deployment-manifest> <destination>
python tools/archive-local-client.py <destination> <new-archive.zip>
```

The packager copies the browser module closure, runtime, license and player guide. It verifies input hashes and the native manifest. The client validates installed files and verifies the remote asset versions before play. Accounts, roles and match history belong to the selected server. An administrator can change remote resource delivery from the lobby.
