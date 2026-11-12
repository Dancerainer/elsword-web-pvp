# Host a server

Build the web bundle and prepare the matching asset and native manifests. Start the Node server with the paths and origin for your deployment. The following PowerShell example uses an illustrative hostname.

```powershell
$env:RF_PORT = '4196'
$env:RF_HOST = '127.0.0.1'
$env:RF_PUBLIC_ORIGIN = 'https://pvp.example.org'
$env:RF_ASSET_ROOT = (Resolve-Path './artifacts').Path
$env:RF_ACCOUNT_ROOT = Join-Path $PWD 'runtime/accounts'
pnpm start
```

Point your reverse proxy at the configured bind address and port. Forward WebSocket upgrades and streaming responses. Use one externally reachable HTTP(S) origin for the login page and API. `RF_PUBLIC_ORIGIN` must match the browser origin, including a non-default port if used. Set `RF_RESOURCE_DELIVERY=1` to serve game resources to authenticated browser clients. Packaged clients read matching assets from their installation.

Set `RF_RTC_ICE_SERVERS` to a JSON array of ICE server settings for your own deployment when using WebRTC. `RF_NETWORK_PEER_MODE` selects the transport mode. The relay path supports peers that cannot connect directly. The [network guide](ONLINE_NETWORK.md) describes ownership and recovery.

Keep accounts and server-side settings in a private persistent directory. The development server reports the location of its generated local credentials at startup. Package a client with the same build and resource hashes as the server. Players select the server through `server-config.json` or `WEB_PVP_SERVER_URL`.
