# Registers the PESU Downloader converter helper (native messaging host) for the current user.
# No admin rights needed. Safe to run again at any time (e.g. after moving the folder).
param([string]$ExtensionId = 'cooigkfjkkbolfcfcdmbmdjpmbmlofab', [string]$FirefoxId = 'pesu-downloader@vismayhs')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostName = 'com.pesu.downloader'

Write-Host "PESU Downloader - installing converter helper" -ForegroundColor Cyan

# 1. Find Python 3
$python = $null
foreach ($cand in @(
        { (Get-Command py -ErrorAction SilentlyContinue) | ForEach-Object { & $_.Source -3 -c "import sys;print(sys.executable)" 2>$null } },
        { (Get-Command python -ErrorAction SilentlyContinue) | ForEach-Object { & $_.Source -c "import sys;print(sys.executable)" 2>$null } },
        { Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName }
    )) {
    try { $p = (& $cand | Select-Object -First 1) } catch { $p = $null }
    if ($p -and (Test-Path $p) -and ($p -notmatch 'WindowsApps')) { $python = $p.Trim(); break }
}
if (-not $python) {
    Write-Host "Python 3 was not found. Install it from https://www.python.org/downloads/ (tick 'Add to PATH') and run install.bat again." -ForegroundColor Red
    exit 1
}
Write-Host "  Python:      $python"

# 2. Optional PDF repair libraries (best effort)
& $python -c "import pypdf" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Installing pypdf (optional, for repairing locked PDFs)..."
    & $python -m pip install --user --quiet pypdf 2>$null | Out-Null
}

# 3. Launcher + host manifest
$bat = Join-Path $here 'run_host.bat'
"@echo off`r`n`"$python`" -u `"%~dp0pesu_host.py`" %*`r`n" | Set-Content -Path $bat -Encoding ASCII -NoNewline
$manifestPath = Join-Path $here "$hostName.json"
$manifest = [ordered]@{
    name            = $hostName
    description     = 'PESU Downloader converter helper'
    path            = $bat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
($manifest | ConvertTo-Json) | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "  Manifest:    $manifestPath"
# Firefox identifies extensions by their add-on id instead of an origin, so it gets its own manifest
$ffManifestPath = Join-Path $here "$hostName.firefox.json"
$ffManifest = [ordered]@{
    name               = $hostName
    description        = 'PESU Downloader converter helper'
    path               = $bat
    type               = 'stdio'
    allowed_extensions = @($FirefoxId)
}
($ffManifest | ConvertTo-Json) | Set-Content -Path $ffManifestPath -Encoding UTF8

# 4. Register for every Chromium browser we know about (HKCU, no admin)
$browsers = @(
    'Software\Google\Chrome',
    'Software\BraveSoftware\Brave-Browser',
    'Software\Microsoft\Edge',
    'Software\Chromium',
    'Software\Vivaldi'
)
foreach ($b in $browsers) {
    $key = "HKCU:\$b\NativeMessagingHosts\$hostName"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath
}
$ffKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
New-Item -Path $ffKey -Force | Out-Null
Set-ItemProperty -Path $ffKey -Name '(default)' -Value $ffManifestPath
Write-Host "  Registered for Chrome, Brave, Edge, Chromium, Vivaldi and Firefox"

# 5. Report available converters
$office = @('PowerPoint.Application', 'Word.Application', 'Excel.Application') | Where-Object { Test-Path "Registry::HKEY_CLASSES_ROOT\$_\CLSID" }
$lo = @("$env:ProgramFiles\LibreOffice\program\soffice.exe", "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Write-Host "  MS Office:   $(if ($office) { ($office -replace '\.Application','') -join ', ' } else { 'not found' })"
Write-Host "  LibreOffice: $(if ($lo) { $lo } else { 'not found' })"
if (-not $office -and -not $lo) {
    Write-Host "`nNo converter found: PDFs will still merge, but PPT/DOC files need MS Office or LibreOffice (https://www.libreoffice.org/download/)." -ForegroundColor Yellow
}
Write-Host "`nDone. Reload the extension page (or restart the browser) to pick up the helper." -ForegroundColor Green
