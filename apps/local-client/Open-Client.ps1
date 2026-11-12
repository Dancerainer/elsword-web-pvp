$ErrorActionPreference = 'SilentlyContinue'
$port = if ($env:EL_CLIENT_PORT) { [int]$env:EL_CLIENT_PORT } else { 4376 }
$origin = "http://127.0.0.1:$port"
for ($attempt = 0; $attempt -lt 240; $attempt++) {
    try {
        $clientStatus = Invoke-RestMethod -Uri "$origin/api/local-client" -TimeoutSec 2
        if ($clientStatus.localResourceClient -eq $true) {
            Start-Process "$origin/"
            exit
        }
    } catch {}
    Start-Sleep -Milliseconds 500
}
