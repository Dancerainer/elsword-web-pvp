# Desktop client

The Windows x64 desktop client packages the game content with Electron. Extract the complete package into its own directory, set the server URL beside the executable, and start `web pvp.exe`. The [player guide](DESKTOP_CLIENT_PLAYER.txt) describes the window controls and updates.

The launcher reads the environment setting before the configuration file. Use a complete HTTP or HTTPS origin, optionally including a port. The proxy keeps the login session isolated per server.

The desktop shell runs the resource proxy in its main process. The game loads through a loopback origin and uses a sandboxed renderer. The toolbar can refresh the game independently if the renderer stalls. The app persists its loopback port and attempts to reuse it so browser preferences survive restarts.

## Package

Supply a verified complete content directory and a matching Windows x64 Electron distribution. Run from the repository root and choose a new output directory under `runtime/`.

```sh
node tools/package-desktop-client.mjs <content-directory> <electron-directory> <output-directory>
python tools/archive-desktop-client.py <output-directory> <new-archive.zip>
```

Retain Electron and Chromium notices with the distribution. Updates verify the content manifest and hashes, journal changes and recover from interruption. Launcher and browser-engine changes require a complete new package.
