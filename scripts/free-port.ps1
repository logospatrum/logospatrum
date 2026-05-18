# Frees a TCP port by killing every owning process tree.
#
# Why: Windows + npm / uvicorn dev servers frequently leave orphan
# node/python children that keep the port in LISTEN after the parent
# (terminal, Ctrl+C) is gone. Re-running the dev server then fails with
# EADDRINUSE.
#
# Usage:
#   pwsh scripts/free-port.ps1 3001        # frontend
#   pwsh scripts/free-port.ps1 8000        # backend uvicorn
#
# This is safe to run when nothing holds the port — it silently no-ops.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [int]$Port
)

$ErrorActionPreference = "Stop"

# Get-NetTCPConnection returns LISTEN sockets; fall back to netstat parsing
# if the cmdlet isn't available (e.g. old PowerShell).
$ownerPids = @()
try {
    $ownerPids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
} catch {
    $ownerPids = @()
}

if (-not $ownerPids -or $ownerPids.Count -eq 0) {
    $matches = netstat -ano | Select-String -Pattern (":$Port\s+.*LISTENING")
    foreach ($line in $matches) {
        $parts = $line.ToString().Trim() -split "\s+"
        if ($parts.Count -ge 5) {
            $pidValue = [int]($parts[-1])
            if ($pidValue -gt 0) { $ownerPids += $pidValue }
        }
    }
    $ownerPids = $ownerPids | Sort-Object -Unique
}

if (-not $ownerPids -or $ownerPids.Count -eq 0) {
    Write-Host "port $Port: free"
    return
}

foreach ($targetPid in $ownerPids) {
    # taskkill /T walks the process tree so spawned children
    # (next start-server.js, uvicorn workers, etc.) get cleaned up too.
    & taskkill.exe /PID $targetPid /T /F 2>&1 | Out-Null
    Write-Host "port ${Port}: killed PID $targetPid (with tree)"
}
