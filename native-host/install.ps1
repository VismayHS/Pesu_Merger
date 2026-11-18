# Sets up the PESU Downloader converter for the current user, all in one go:
#   1. checks for Python, and offers to install it if it is missing
#   2. registers the helper with every supported browser (Chrome, Brave, Edge, Chromium, Vivaldi, Firefox)
#   3. checks for Microsoft Office or LibreOffice, and offers to install LibreOffice (free) if neither is there
#   4. tests the helper the way the browser starts it
# No admin rights needed for the helper itself. Safe to run again at any time (e.g. after moving the folder).
#
#   install.bat            asks before installing anything
#   install.bat -Yes       installs whatever is missing without asking
#   install.bat -DryRun    only reports what it finds and what it would install; changes nothing
param(
    [string]$ExtensionId = 'cooigkfjkkbolfcfcdmbmdjpmbmlofab',
    [string]$FirefoxId = 'pesu-downloader@vismayhs',
    [switch]$Yes,
    [switch]$DryRun
)
# 'Continue': Windows PowerShell 5.1 turns any stderr output of a program (python, pip, winget) into a
# fatal error under 'Stop'. The steps that must not fail half-way use -ErrorAction Stop inside a try.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostName = 'com.pesu.downloader'
$winget = Get-Command winget -ErrorAction SilentlyContinue

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

function Ask([string]$question) {
    if ($Yes) { return $true }
    try { $a = Read-Host "  $question [Y/n]" } catch { return $false }
    return ($a -eq '' -or $a -match '^\s*(y|yes)\s*$')
}

# Offers to install a program with winget (built into Windows 10 and 11). Returns $true if it ran the install.
function Install-WithWinget([string]$what, [string]$id, [string[]]$extra, [string]$size, [string]$note) {
    if (-not $winget) {
        Say "  (Windows' built-in installer 'winget' isn't available here, so $what can't be installed automatically.)" Yellow
        return $false
    }
    if ($DryRun) {
        Say "  [dry run] would offer to install $what ($size): winget install --exact --id $id $($extra -join ' ')" Cyan
        return $false
    }
    if (-not (Ask "Install $what now? It's free ($size).$note")) { return $false }
    Say "  Installing $what... this can take a few minutes. Please don't close this window."
    try {
        & $winget.Source install --exact --id $id --silent --accept-package-agreements --accept-source-agreements @extra
    } catch {
        Say "  The installation didn't finish: $($_.Exception.Message)" Yellow
    }
    return $true
}

function Open-Page([string]$url) {
    if ($DryRun) { Say "  [dry run] would open $url" Cyan; return }
    try { Start-Process $url } catch { }
}

function Find-Python {
    foreach ($cand in @(
            { (Get-Command py -ErrorAction SilentlyContinue) | ForEach-Object { & $_.Source -3 -c "import sys;print(sys.executable)" 2>$null } },
            { (Get-Command python -ErrorAction SilentlyContinue) | ForEach-Object { & $_.Source -c "import sys;print(sys.executable)" 2>$null } },
            { Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName },
            # where python.org's newer "Python install manager" puts it
            { Get-ChildItem "$env:LOCALAPPDATA\Python\pythoncore-3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName },
            { Get-ChildItem "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName }
        )) {
        try { $p = (& $cand | Select-Object -First 1) } catch { $p = $null }
        # the "python" in WindowsApps is only a shortcut to the Microsoft Store, not a real Python
        if ($p -and (Test-Path $p) -and ($p -notmatch 'WindowsApps')) { return $p.Trim() }
    }
    return $null
}

# Asks the helper what it can do. With a launcher it starts the helper the way the browser does.
function Test-Helper([string]$python, [string]$launcher) {
    $args2 = @(Join-Path $here 'selftest.py')
    if ($launcher) { $args2 += $launcher }
    try {
        $line = & $python @args2 2>$null | Select-Object -Last 1
        return ($line | ConvertFrom-Json)
    } catch {
        return [pscustomobject]@{ ok = $false; office = @(); libreoffice = ''; error = 'the self-test could not run' }
    }
}

function Describe-Converter($st) {
    $parts = @()
    if ($st.office -and @($st.office).Count) {
        $names = @($st.office | ForEach-Object { (Get-Culture).TextInfo.ToTitleCase($_) -replace 'Powerpoint', 'PowerPoint' })
        $parts += "MS Office ($($names -join ', '))"
    }
    if ($st.libreoffice) { $parts += 'LibreOffice' }
    return ($parts -join ' + ')
}

Say ''
Say 'PESU Downloader - setting up the converter' Cyan
if ($DryRun) { Say '(dry run: nothing will be installed or changed)' Cyan }
Say ''

# ---------------------------------------------------------------- 1. Python
$python = Find-Python
if (-not $python) {
    Say '  Python:      not found' Yellow
    Say '  The converter needs Python 3 (free) to run.'
    if (Install-WithWinget 'Python 3' 'Python.Python.3.12' @('--scope', 'user') 'about 30 MB' '') { $python = Find-Python }
    if (-not $python) {
        Open-Page 'https://www.python.org/downloads/'
        Say ''
        Say 'NOT FINISHED: Python is needed.' Red
        Say '  1. On the python.org page, click "Download Python 3".'
        Say '  2. Open the downloaded file and TICK "Add python.exe to PATH" on the first screen, then Install Now.'
        Say '  3. Run install.bat again.'
        exit 1
    }
}
Say "  Python:      $python"

# ---------------------------------------------------------------- 2. register the helper
$bat = Join-Path $here 'run_host.bat'
if ($DryRun) {
    Say '  [dry run] would register the helper for Chrome, Brave, Edge, Chromium, Vivaldi and Firefox' Cyan
} else {
    # optional library that repairs damaged or locked PDFs (best effort)
    & $python -c "import pypdf" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Say '  Installing pypdf (optional, repairs damaged PDFs)...'
        try { & $python -m pip install --user --quiet pypdf 2>$null | Out-Null } catch { }
    }

    try {
        "@echo off`r`n`"$python`" -u `"%~dp0pesu_host.py`" %*`r`n" | Set-Content -Path $bat -Encoding ASCII -NoNewline -ErrorAction Stop
        $manifestPath = Join-Path $here "$hostName.json"
        $manifest = [ordered]@{
            name            = $hostName
            description     = 'PESU Downloader converter helper'
            path            = $bat
            type            = 'stdio'
            allowed_origins = @("chrome-extension://$ExtensionId/")
        }
        ($manifest | ConvertTo-Json) | Set-Content -Path $manifestPath -Encoding UTF8 -ErrorAction Stop
        # Firefox identifies extensions by their add-on id instead of an origin, so it gets its own manifest
        $ffManifestPath = Join-Path $here "$hostName.firefox.json"
        $ffManifest = [ordered]@{
            name               = $hostName
            description        = 'PESU Downloader converter helper'
            path               = $bat
            type               = 'stdio'
            allowed_extensions = @($FirefoxId)
        }
        ($ffManifest | ConvertTo-Json) | Set-Content -Path $ffManifestPath -Encoding UTF8 -ErrorAction Stop

        foreach ($b in @('Software\Google\Chrome', 'Software\BraveSoftware\Brave-Browser', 'Software\Microsoft\Edge', 'Software\Chromium', 'Software\Vivaldi')) {
            $key = "HKCU:\$b\NativeMessagingHosts\$hostName"
            New-Item -Path $key -Force -ErrorAction Stop | Out-Null
            Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath -ErrorAction Stop
        }
        $ffKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
        New-Item -Path $ffKey -Force -ErrorAction Stop | Out-Null
        Set-ItemProperty -Path $ffKey -Name '(default)' -Value $ffManifestPath -ErrorAction Stop
        Say '  Registered:  Chrome, Brave, Edge, Chromium, Vivaldi and Firefox'
    } catch {
        Say ''
        Say "NOT FINISHED: couldn't register the helper ($($_.Exception.Message))." Red
        Say '  Make sure the project folder is somewhere you can write to (such as Documents) and run install.bat again.'
        exit 4
    }
}

# ---------------------------------------------------------------- 3. Office / LibreOffice + self-test
$launcher = $null
if (-not $DryRun) { $launcher = $bat }
$st = Test-Helper $python $launcher
if (-not $st.ok) {
    Say ''
    Say "NOT FINISHED: the helper didn't start ($($st.error))." Red
    Say "  Look at $env:LOCALAPPDATA\PESUDownloader\host.log, or open an issue on GitHub with this window's text."
    exit 3
}
$found = Describe-Converter $st
if (-not $found) {
    Say '  Converter:   no Microsoft Office or LibreOffice found' Yellow
    Say '  Most PESU courses have PowerPoint and Word files. To turn them into PDF you need'
    Say '  Microsoft Office or LibreOffice. LibreOffice is free.'
    if (Install-WithWinget 'LibreOffice' 'TheDocumentFoundation.LibreOffice' @() 'about 350 MB download' ' Windows will ask for permission once - click Yes.') {
        $st = Test-Helper $python $launcher
        $found = Describe-Converter $st
    }
    if (-not $found) {
        Open-Page 'https://www.libreoffice.org/download/download-libreoffice/'
        Say ''
        Say 'NOT FINISHED: install LibreOffice (or Microsoft Office).' Red
        Say '  1. On the LibreOffice page, click Download, open the file and keep clicking Next, then Install.'
        Say '  2. Then press Re-check in PESU Downloader. (No need to run this installer again.)'
        exit 2
    }
}
Say "  Converter:   $found" Green
Say '  Self-test:   OK'
Say ''
if ($DryRun) {
    Say 'Dry run finished: everything needed is already on this computer.' Green
} else {
    Say 'ALL SET!' Green
    Say '  Restart your browser once, then open PESU Downloader.'
    $chip = @()
    if (@($st.office) -contains 'powerpoint' -or @($st.office) -contains 'word') { $chip += 'MS Office' }
    if ($st.libreoffice) { $chip += 'LibreOffice' }
    Say "  The top-right corner should say: Converter: $($chip -join ' + ')"
}
