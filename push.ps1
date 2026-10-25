# 部署到 GitHub
$ErrorActionPreference = 'Stop'
$token = ([System.IO.File]::ReadAllText('D:\AI\.gh-token.txt')).Trim()
$headers = @{
    'Authorization' = "Bearer $token"; 'Accept' = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'tx-deploy'
    'Content-Type' = 'application/json'
}
$repo = 'Zzzckol/treatment-tracker'
$root = 'D:\AI\treatment-tracker'
$skip = @('deploy.mjs','make-icons.py','make-qr.py','push-to-github.ps1')

$files = Get-ChildItem $root -Recurse -File | Where-Object {
    $rel = $_.FullName.Replace($root + '\', '')
    ($skip -notcontains $rel) -and ($rel -notmatch '^\.tmp') -and ($rel -notmatch '^_') -and ($rel -notmatch 'hosts\.backup')
}
Write-Host "上传 $($files.Count) 个文件..." -ForegroundColor Cyan
$ok = 0; $bad = @()
foreach ($file in $files) {
    $rel = $file.FullName.Replace($root + '\', '').Replace('\', '/')
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($file.FullName))
    $apiUrl = "https://api.github.com/repos/$repo/contents/$rel"
    $sha = $null
    try { $meta = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 20; $sha = $meta.sha } catch { }
    $payload = @{ message = "更新 $rel"; content = $b64; branch = 'main' }
    if ($sha) { $payload.sha = $sha }
    try {
        Invoke-RestMethod -Uri $apiUrl -Method Put -Headers $headers -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 30 | Out-Null
        $ok++
    } catch { $bad += $rel }
}
Write-Host "成功 $ok / $($files.Count)" -ForegroundColor $(if($ok -eq $files.Count){'Green'}else{'Yellow'})
if ($bad) { $bad | ForEach-Object { Write-Host "  失败: $_" -ForegroundColor Red } }
