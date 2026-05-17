# Convenience wrapper: free port 2024 (kill any orphan langgraph dev /
# uvicorn child) and start a fresh langgraph dev session.
#
# Usage (from apps/backend/):
#   pwsh dev.ps1
#   pwsh dev.ps1 -Port 2030      # use a different port if 2024 is wedged in TIME_WAIT
#
# Equivalent to the long-form invocation documented in CLAUDE.md.

[CmdletBinding()]
param(
    [int]$Port = 2024
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$freePort = Join-Path $repoRoot "scripts\free-port.ps1"

& $freePort $Port

$env:PYTHONUTF8 = "1"
& "$PSScriptRoot\.venv\Scripts\langgraph.exe" dev --port $Port --no-browser
