# Persistent Office -> PDF worker.
# Reads one JSON request per line on stdin: {"kind":"powerpoint|word|excel","in":"C:\..\in.pptx","out":"C:\..\out.pdf"}
# Writes one JSON response per line on stdout: {"ok":true} or {"ok":false,"error":"..."}
# Office applications are started once and reused (much faster than one process per file).
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$apps = @{}
$startedByUs = @{}
$procNames = @{ powerpoint = 'POWERPNT'; word = 'WINWORD'; excel = 'EXCEL' }
$progIds = @{ powerpoint = 'PowerPoint.Application'; word = 'Word.Application'; excel = 'Excel.Application' }

function Get-OfficeApp([string]$kind) {
    if ($apps.ContainsKey($kind)) {
        try { $null = $apps[$kind].Name; return $apps[$kind] } catch { $apps.Remove($kind) }
    }
    $wasRunning = [bool](Get-Process -Name $procNames[$kind] -ErrorAction SilentlyContinue)
    $app = New-Object -ComObject $progIds[$kind]
    try { $app.AutomationSecurity = 3 } catch {}   # msoAutomationSecurityForceDisable: never run macros
    switch ($kind) {
        'powerpoint' { try { $app.DisplayAlerts = 1 } catch {} }      # ppAlertsNone
        'word' { $app.Visible = $false; $app.DisplayAlerts = 0; try { $app.Options.DoNotPromptForConvert = $true; $app.Options.ConfirmConversions = $false } catch {} }
        'excel' { $app.Visible = $false; $app.DisplayAlerts = $false; $app.AskToUpdateLinks = $false }
    }
    $apps[$kind] = $app
    $startedByUs[$kind] = -not $wasRunning
    return $app
}

function Convert-One($req) {
    $in = [string]$req.in
    $out = [string]$req.out
    switch ($req.kind) {
        'powerpoint' {
            $app = Get-OfficeApp 'powerpoint'
            # Open(FileName, ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse)
            $p = $app.Presentations.Open($in, -1, 0, 0)
            try { $p.SaveAs($out, 32) }                      # ppSaveAsPDF
            finally { $p.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($p) }
        }
        'word' {
            $app = Get-OfficeApp 'word'
            # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate)
            # A dummy password stops Word from blocking on a password prompt for protected files.
            $d = $app.Documents.Open($in, $false, $true, $false, 'pesu-no-password', 'pesu-no-password')
            try { $d.ExportAsFixedFormat($out, 17) }         # wdExportFormatPDF
            finally { $d.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($d) }
        }
        'excel' {
            $app = Get-OfficeApp 'excel'
            $w = $app.Workbooks.Open($in, 0, $true)
            try { $w.ExportAsFixedFormat(0, $out) }          # xlTypePDF
            finally { $w.Close($false); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($w) }
        }
        default { throw "Unknown kind $($req.kind)" }
    }
}

function Send($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

try {
    Send @{ ready = $true }
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ($line.Trim() -eq '') { continue }
        try {
            $req = $line | ConvertFrom-Json
            if ($req.kind -eq 'quit') { break }
            Convert-One $req
            if (-not (Test-Path -LiteralPath $req.out)) { throw 'Office did not produce a PDF' }
            Send @{ ok = $true }
        }
        catch {
            Send @{ ok = $false; error = ($_.Exception.Message -replace '\s+', ' ') }
        }
    }
}
finally {
    foreach ($k in @($apps.Keys)) {
        try {
            if ($startedByUs[$k]) {
                $a = $apps[$k]
                if ($k -eq 'powerpoint') { if ($a.Presentations.Count -eq 0) { $a.Quit() } } else { $a.Quit() }
            }
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($apps[$k])
        } catch {}
    }
    [GC]::Collect()
}
