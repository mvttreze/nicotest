# Registers the Nico stack to auto-start at Windows logon (minimized).
# Sleeps still pause everything - a laptop cannot serve while asleep or off.
# For true 24/7, host the gateway on a Pi/VPS and point Render at it instead.
#
# Usage: .\install_nico_autostart.ps1
# Remove: .\uninstall_nico_autostart.ps1  (or .\stop_nico_stack.ps1 for one stop)
$ErrorActionPreference = "Stop"

$taskName = "NicoStack"
$script = Join-Path $PSScriptRoot "start_nico_stack.ps1"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$script`" -NoBrowser" `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop } catch {}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings |
  Out-Null
Write-Host "Autostart installed: $taskName runs at logon (minimized, no browser)." -ForegroundColor Green
Write-Host "Test it now: log off and back on, or run: schtasks /run /tn $taskName" -ForegroundColor Cyan
