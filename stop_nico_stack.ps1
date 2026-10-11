# Stops the windows/processes started by start_nico_stack.ps1.
# Matches by command line, so it never touches anything else.
$ErrorActionPreference = "Continue"

$patterns = @(
  "server.dist.index.js",   # FreeLLMAPI gateway (node server/dist/index.js)
  "main.py",                # Nico backend (python main.py)
  "http.server 5500",       # local web
  "electron ."              # desktop app (npm start -> electron .)
)

foreach ($pat in $patterns) {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'python.exe' OR Name = 'powershell.exe' OR Name = 'electron.exe'" |
    Where-Object { $_.CommandLine -like "*$pat*" }
  foreach ($p in $procs) {
    try {
      Stop-Process -Id $p.ProcessId -Force
      Write-Host "Stopped $($p.Name) ($pat, pid $($p.ProcessId))" -ForegroundColor Yellow
    } catch {
      Write-Host "Could not stop pid $($p.ProcessId): $_" -ForegroundColor Red
    }
  }
}
Write-Host "Done. (Your opencode session shells are separate and untouched.)" -ForegroundColor Green
