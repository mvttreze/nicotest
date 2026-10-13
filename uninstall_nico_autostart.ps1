# Removes the NicoStack logon task. Does not stop a running stack -
# run .\stop_nico_stack.ps1 for that.
$ErrorActionPreference = "Stop"

try {
  Unregister-ScheduledTask -TaskName "NicoStack" -Confirm:$false -ErrorAction Stop
  Write-Host "Autostart removed." -ForegroundColor Green
} catch {
  Write-Host "No NicoStack task found (nothing to remove)." -ForegroundColor Yellow
}
