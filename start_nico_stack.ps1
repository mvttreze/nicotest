# Nico full-stack launcher (Windows).
# Order: FreeLLMAPI gateway (:3001) -> Nico backend (:8000) -> local web (:5500) -> browser.
# Already-running services are detected by port and left alone.
#
# Usage:
#   .\start_nico_stack.ps1                 # gateway + backend + web + browser
#   .\start_nico_stack.ps1 -Desktop        # also launches the Electron desktop app
#   .\start_nico_stack.ps1 -NoDirectKeys   # blank GROQ/OPENCODE keys (gateway A/B test)
param(
  [switch]$Desktop,
  [switch]$NoDirectKeys,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$nicoRoot = $PSScriptRoot
$gatewayDir = Join-Path $env:USERPROFILE "freellmapi"

function Test-PortOpen($port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800)
    $client.Close()
    return $ok
  } catch { return $false }
}

function Wait-Port($port, $name, $seconds = 60) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-PortOpen $port) { Write-Host "$name is up (:$port)" -ForegroundColor Green; return }
    Start-Sleep -Seconds 1
  }
  Write-Host "$name did not answer on :$port after $seconds seconds - check its window." -ForegroundColor Red
  exit 1
}

function Start-ServiceWindow($title, $dir, $command) {
  $inner = "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$dir'; $command"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $inner
  Write-Host "Opened window: $title" -ForegroundColor Cyan
}

# 1. FreeLLMAPI gateway
if (Test-PortOpen 3001) {
  Write-Host "Gateway already running (:3001), skipping." -ForegroundColor Yellow
} else {
  if (-not (Test-Path (Join-Path $gatewayDir "server/dist/index.js"))) {
    Write-Host "Gateway build missing at $gatewayDir - run npm run build there first." -ForegroundColor Red
    exit 1
  }
  Start-ServiceWindow "Nico gateway :3001" $gatewayDir "node server/dist/index.js"
  Wait-Port 3001 "Gateway"
}

# 2. Nico backend
if (Test-PortOpen 8000) {
  Write-Host "Backend already running (:8000), skipping." -ForegroundColor Yellow
} else {
  $backendPy = Join-Path $nicoRoot "venv\Scripts\python.exe"
  if (-not (Test-Path $backendPy)) { $backendPy = "python" }
  $envPrefix = ""
  if ($NoDirectKeys) {
    $envPrefix = "`$env:GROQ_API_KEY=''; `$env:OPENCODE_API_KEY=''; "
    Write-Host "NoDirectKeys: direct Groq/Zen legs blanked (gateway-only mode)." -ForegroundColor Yellow
  }
  Start-ServiceWindow "Nico backend :8000" $nicoRoot "$envPrefix& '$backendPy' main.py"
  Wait-Port 8000 "Backend" 90
}

# 3. Local web (auto-targets the local backend)
if (Test-PortOpen 5500) {
  Write-Host "Local web already running (:5500), skipping." -ForegroundColor Yellow
} else {
  Start-ServiceWindow "Nico web :5500" $nicoRoot "python -m http.server 5500"
  Wait-Port 5500 "Local web"
}

# 4. Desktop app (optional)
if ($Desktop) {
  Start-ServiceWindow "Nico desktop" (Join-Path $nicoRoot "nico-desktop") "npm start"
}

Write-Host ""
Write-Host "Stack ready: open http://localhost:5500" -ForegroundColor Green
if (-not $NoBrowser) {
  Start-Process "http://localhost:5500"
}
