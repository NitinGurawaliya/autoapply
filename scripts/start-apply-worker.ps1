# Starts the worker that applies (npm run worker:prod) and starts it again whenever it stops, so a sleep, a network drop
# that ends the process or a crash does not leave applications waiting. One copy at a time on this computer (a named
# mutex): a second run says so and exits. It cannot see a worker you started by hand in a terminal: stop that one first,
# two apply workers on one queue take applications from each other.
#   powershell -NoProfile -File scripts\start-apply-worker.ps1          (runs until the window is closed)
#   powershell -NoProfile -File scripts\start-apply-worker.ps1 -Check   (checks the folder and the mutex, starts nothing)
# To run it when Windows starts: docs/DEPLOY.md, "The worker that applies".
param([switch]$Check)

$root = Split-Path -Parent $PSScriptRoot
$mutex = New-Object System.Threading.Mutex($false, "Global\swipeapply-apply-worker")
if (-not $mutex.WaitOne(0)) {
  Write-Host "The apply worker is already running from this script."
  exit 0
}
try {
  if (-not (Test-Path (Join-Path $root "package.json")) -or -not (Test-Path (Join-Path $root "src\worker\index.ts"))) {
    Write-Host "Not the SwipeApply folder: $root"
    exit 1
  }
  if ($Check) {
    Write-Host "ok: would run 'npm run worker:prod' in $root"
    exit 0
  }
  Set-Location $root
  while ($true) {
    Write-Host ("{0} starting the apply worker" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
    npm run worker:prod
    Write-Host ("{0} the worker stopped (exit {1}); starting it again in 15 seconds" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $LASTEXITCODE)
    Start-Sleep -Seconds 15
  }
} finally {
  $mutex.ReleaseMutex()
}
