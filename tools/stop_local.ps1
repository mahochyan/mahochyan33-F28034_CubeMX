$ErrorActionPreference = "Stop"
$instancePath = Join-Path (Split-Path $PSScriptRoot -Parent) "generator\instance.json"
if (-not (Test-Path -LiteralPath $instancePath)) {
    Write-Host "[INFO] No local instance registry exists."
    exit 0
}
$instance = Get-Content -LiteralPath $instancePath -Raw -Encoding UTF8 | ConvertFrom-Json
$port = [int]$instance.port
$pidFromRegistry = [int]$instance.pid
Write-Host "[INFO] Stopping build $($instance.build_id), PID $pidFromRegistry, port $port ..."
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/shutdown" `
        -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
} catch {
    Write-Host "[WARN] Shutdown endpoint did not answer; checking the recorded process."
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$pidFromRegistry" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -match "app\.py") {
        Stop-Process -Id $pidFromRegistry -Force
    }
}
$released = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) {
        $released = $true
        break
    }
    Start-Sleep -Milliseconds 200
}
if (-not $released) {
    Write-Host "[ERROR] Port $port is still listening."
    exit 1
}
if (Test-Path -LiteralPath $instancePath) {
    Remove-Item -LiteralPath $instancePath -Force
}
Write-Host "[OK] Port $port has been released."
