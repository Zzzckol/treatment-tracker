# Fix github.com access by editing hosts (reversible)
# Run: right-click -> Run with PowerShell, or execute in an ADMIN PowerShell.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Need administrator rights. Right-click this file -> Run as administrator." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$hostsPath = "$env:WINDIR\System32\drivers\etc\hosts"
$backupDir = "D:\AI\treatment-tracker"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDir "hosts.backup-$stamp.txt"

# GitHub edge IPs verified reachable from this machine
$ips = @(
    '20.27.177.113',
    '140.82.113.4',
    '140.82.114.4'
)

$marker = '# === treatment-tracker: GitHub fix (BEGIN) ==='
$markerEnd = '# === treatment-tracker: GitHub fix (END) ==='

Write-Host ""
Write-Host "[1/4] Backing up hosts ..." -ForegroundColor Cyan
Copy-Item $hostsPath $backupPath -Force
Write-Host "  Saved to: $backupPath" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Removing old fix entries ..." -ForegroundColor Cyan
$lines = Get-Content $hostsPath -ErrorAction SilentlyContinue
$out = New-Object System.Collections.ArrayList
$skip = $false
foreach ($l in $lines) {
    if ($l -eq $marker) { $skip = $true; continue }
    if ($l -eq $markerEnd) { $skip = $false; continue }
    if (-not $skip) { [void]$out.Add($l) }
}
Write-Host "  Done" -ForegroundColor Green

Write-Host ""
Write-Host "[3/4] Writing new entries ..." -ForegroundColor Cyan
[void]$out.Add('')
[void]$out.Add($marker)
foreach ($ip in $ips) {
    [void]$out.Add("$ip github.com")
}
[void]$out.Add("$($ips[0]) www.github.com")
[void]$out.Add($markerEnd)

$content = ($out -join "`r`n")
[System.IO.File]::WriteAllText($hostsPath, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  Wrote $($ips.Count) IP entries" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] Flushing DNS ..." -ForegroundColor Cyan
ipconfig /flushdns | Out-Null
Write-Host "  Done" -ForegroundColor Green

Write-Host ""
Write-Host "Testing connection ..." -ForegroundColor Cyan
Start-Sleep -Seconds 1
$ok = $false
try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $c = New-Object System.Net.Sockets.TcpClient
    $t = $c.ConnectAsync('github.com', 443)
    if ($t.Wait(5000)) {
        $elapsed = $sw.ElapsedMilliseconds
        Write-Host "  github.com:443 connected in ${elapsed} ms" -ForegroundColor Green
        $ok = $true
    } else {
        Write-Host "  Still timing out" -ForegroundColor Red
    }
    $c.Close()
} catch {
    Write-Host "  Test failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
if ($ok) {
    Write-Host "SUCCESS - refresh your browser and try github.com again." -ForegroundColor Green
} else {
    Write-Host "Still not connected. You can edit hosts and try another IP." -ForegroundColor Yellow
    Write-Host "Backup: $backupPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "To undo, run: restore-hosts.ps1" -ForegroundColor Gray
Read-Host "Press Enter to close"
