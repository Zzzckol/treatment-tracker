# Undo the github.com hosts fix
# Run: right-click -> Run with PowerShell, or execute in an ADMIN PowerShell.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Need administrator rights." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"
$marker = '# === treatment-tracker: GitHub fix (BEGIN) ==='
$markerEnd = '# === treatment-tracker: GitHub fix (END) ==='

Write-Host ""
Write-Host "Cleaning hosts fix entries ..." -ForegroundColor Cyan

$lines = Get-Content $hostsPath -ErrorAction SilentlyContinue
$out = New-Object System.Collections.ArrayList
$skip = $false
$found = 0
foreach ($l in $lines) {
    if ($l -eq $marker) { $skip = $true; $found++; continue }
    if ($l -eq $markerEnd) { $skip = $false; continue }
    if (-not $skip) { [void]$out.Add($l) }
}

if ($found -eq 0) {
    Write-Host "  No fix entries found, nothing to do." -ForegroundColor Yellow
} else {
    while ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -eq '') {
        $out.RemoveAt($out.Count - 1)
    }
    $content = ($out -join "`r`n")
    [System.IO.File]::WriteAllText($hostsPath, $content, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  Removed." -ForegroundColor Green
}

ipconfig /flushdns | Out-Null
Write-Host "  DNS cache flushed." -ForegroundColor Green
Write-Host ""
Write-Host "Done. github.com is back to system default resolution." -ForegroundColor Green

Read-Host "Press Enter to close"
