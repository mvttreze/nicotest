param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$nicoRoot = $PSScriptRoot
$reactRoot = Join-Path $nicoRoot "nico-react"
$venvPython = Join-Path $nicoRoot "venv\Scripts\python.exe"
$backendUrl = "http://127.0.0.1:8000"
$frontendUrl = "http://127.0.0.1:5500"
$startedProcesses = New-Object System.Collections.Generic.List[int]

function Test-PortOpen {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }
    $client.EndConnect($result)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-BackendReady {
  try {
    $health = Invoke-RestMethod -Uri "$backendUrl/health" -TimeoutSec 3
    return $health.status -eq "ok"
  } catch {
    return $false
  }
}

function Test-FrontendReady {
  try {
    $page = Invoke-WebRequest -Uri "$frontendUrl/index.html" -UseBasicParsing -TimeoutSec 3
    return (
      $page.StatusCode -eq 200 -and
      $page.Content.Contains("NICO AI") -and
      $page.Content.Contains("nico-react/dist/nico-react-ui.js")
    )
  } catch {
    return $false
  }
}

function Wait-ForService {
  param(
    [string]$Name,
    [scriptblock]$ReadyCheck,
    [int]$TimeoutSeconds = 45
  )

  $lastError = "No response yet."
  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    try {
      if (& $ReadyCheck) {
        Write-Host "$Name is ready." -ForegroundColor Green
        return
      }
      $lastError = "The endpoint responded but was not the expected Nico service."
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  throw "$Name did not become ready within $TimeoutSeconds seconds. Last check: $lastError"
}

try {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    throw "npm.cmd was not found. Install Node.js 20+ and run this script again."
  }

  Write-Host "Installing React UI dependencies..." -ForegroundColor Cyan
  & $npmCommand.Source ci --prefix $reactRoot
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE."
  }

  Write-Host "Building React UI..." -ForegroundColor Cyan
  & $npmCommand.Source run build --prefix $reactRoot
  if ($LASTEXITCODE -ne 0) {
    throw "The React UI build failed with exit code $LASTEXITCODE."
  }

  $reactBundle = Join-Path $reactRoot "dist\nico-react-ui.js"
  $reactStyles = Join-Path $reactRoot "dist\nico-react-ui.css"
  if (-not (Test-Path $reactBundle) -or -not (Test-Path $reactStyles)) {
    throw "The React build did not produce both JavaScript and CSS assets."
  }

  if (-not (Test-Path $venvPython)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
      throw "Python was not found. Install Python 3.11+ and run this script again."
    }
    Write-Host "Creating the Nico Python environment..." -ForegroundColor Cyan
    & $pythonCommand.Source -m venv (Join-Path $nicoRoot "venv")
    if ($LASTEXITCODE -ne 0) {
      throw "Creating the Python virtual environment failed with exit code $LASTEXITCODE."
    }
  }

  Push-Location $nicoRoot
  try {
    & $venvPython -c "import fastapi, uvicorn; import main"
    $backendImportExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($backendImportExitCode -ne 0) {
    Write-Host "Installing Nico backend dependencies..." -ForegroundColor Cyan
    & $venvPython -m pip install -r (Join-Path $nicoRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
      throw "Installing Python requirements failed with exit code $LASTEXITCODE."
    }
    Push-Location $nicoRoot
    try {
      & $venvPython -c "import fastapi, uvicorn; import main"
      $backendImportExitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($backendImportExitCode -ne 0) {
      throw "The Nico backend still cannot be imported after installing its requirements."
    }
  }

  if (Test-PortOpen 8000) {
    if (-not (Test-BackendReady)) {
      throw "Port 8000 is occupied by a service that did not respond as Nico. Stop it, then retry."
    }
    Write-Host "Reusing Nico backend on port 8000." -ForegroundColor Yellow
  } else {
    $previousAllowDemoAuth = $env:ALLOW_DEMO_AUTH
    $previousAllowedOrigins = $env:ALLOWED_ORIGINS
    $env:ALLOW_DEMO_AUTH = "true"
    $env:ALLOWED_ORIGINS = "http://127.0.0.1:5500,http://localhost:5500"
    try {
      $backendProcess = Start-Process `
        -FilePath $venvPython `
        -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $nicoRoot `
        -PassThru
    } finally {
      if ($null -eq $previousAllowDemoAuth) {
        Remove-Item Env:ALLOW_DEMO_AUTH -ErrorAction SilentlyContinue
      } else {
        $env:ALLOW_DEMO_AUTH = $previousAllowDemoAuth
      }
      if ($null -eq $previousAllowedOrigins) {
        Remove-Item Env:ALLOWED_ORIGINS -ErrorAction SilentlyContinue
      } else {
        $env:ALLOWED_ORIGINS = $previousAllowedOrigins
      }
    }
    $startedProcesses.Add($backendProcess.Id)
    Wait-ForService "Nico backend" { Test-BackendReady }
  }

  if (Test-PortOpen 5500) {
    if (-not (Test-FrontendReady)) {
      throw "Port 5500 is occupied by a site that is not this Nico frontend. Stop it, then retry."
    }
    Write-Host "Reusing Nico frontend on port 5500." -ForegroundColor Yellow
  } else {
    $frontendProcess = Start-Process `
      -FilePath $venvPython `
      -ArgumentList @("-m", "http.server", "5500", "--bind", "127.0.0.1") `
      -WorkingDirectory $nicoRoot `
      -PassThru
    $startedProcesses.Add($frontendProcess.Id)
    Wait-ForService "Nico frontend" { Test-FrontendReady }
  }

  Write-Host ""
  Write-Host "Nico is ready for local testing:" -ForegroundColor Green
  Write-Host "  Frontend: $frontendUrl"
  Write-Host "  Backend:  $backendUrl"
  Write-Host "  React:    $reactBundle"
  Write-Host "Local demo auth is enabled for the backend process only; .env was not changed."
  if ($startedProcesses.Count -gt 0) {
    Write-Host "Server process IDs started by this run: $($startedProcesses -join ', ')"
    Write-Host "Close the corresponding server windows to stop them."
  }

  if (-not $NoBrowser) {
    Start-Process $frontendUrl
  }
} catch {
  foreach ($processId in $startedProcesses) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Write-Error $_
  exit 1
}
