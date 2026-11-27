#--AGENT--
# Shanon pro Windows — tisková stanice (PowerShell 5.1, bez instalace dalšího běhového prostředí).
#
# Instalace: osobní instalátor ze Shanonu (Integrace → Zařízení → Stáhnout instalaci) před tento text
# doplní $SetupUrl, $SetupPair (párovací kód) a $SetupIcon. Instalace zkopíruje program do
# %LOCALAPPDATA%\ShanonPokladna, spáruje stanici (klíč uložený šifrovaně pro uživatele Windows — DPAPI),
# stáhne SumatraPDF (tichý tisk PDF), vytvoří zástupce „Shanon“ s ikonou a spustí stanici
# po přihlášení do Windows.
#
# Stanice: dlouhým dotazem čeká na tiskové úlohy (/api/station/jobs), stáhne PDF a vytiskne ho
# SumatraPDF na tiskárnu z napojení, výsledek nahlásí. Každých 10 minut (a na žádost Shanonu hned) nahlásí
# tiskárny Windows i s jejich stavem a frontou. Když Shanon hlásí novější verzi programu, stanice se sama
# aktualizuje (/api/station/agent) a spustí znovu.

$ErrorActionPreference = 'Stop'
$Version = '1.3.0'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# SHANON_STATION_DIR = jiná složka (zkouška stanice bez instalace)
$AppDir = if ($env:SHANON_STATION_DIR) { $env:SHANON_STATION_DIR } else { Join-Path $env:LOCALAPPDATA 'ShanonPokladna' }
$ConfigPath = Join-Path $AppDir 'config.json'
$LogPath = Join-Path $AppDir 'stanice.log'
$SumatraExe = Join-Path $AppDir 'SumatraPDF\SumatraPDF.exe'
$SumatraUrl = 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip'
$SumatraSha = '66ccb395c9184dce6822dfbb9970c877383b3ead6d9417b5106a844aac512989'
$Utf8Bom = New-Object System.Text.UTF8Encoding $true

function Write-Log([string]$Text) {
  try {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 1MB) { Move-Item $LogPath "$LogPath.old" -Force }
    Add-Content -Path $LogPath -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Text) -Encoding UTF8
  } catch { }
}

function Show-Message([string]$Text, [string]$Icon = 'Information') {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Text, 'Shanon', 'OK', $Icon)
}

function Find-Browser {
  $paths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Icon, [int]$WindowStyle = 1) {
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($Path)
  $lnk.TargetPath = $Target
  $lnk.Arguments = $Arguments
  $lnk.WorkingDirectory = $AppDir
  $lnk.IconLocation = "$Icon,0"
  $lnk.WindowStyle = $WindowStyle
  $lnk.Description = 'Shanon'
  $lnk.Save()
}

function Invoke-Json([string]$Method, [string]$Url, $Body, [hashtable]$Headers = @{}, [int]$Timeout = 30) {
  $req = @{ Method = $Method; Uri = $Url; Headers = $Headers; TimeoutSec = $Timeout; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $req.ContentType = 'application/json; charset=utf-8'
    $req.Body = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
  }
  return Invoke-RestMethod @req
}

function Install-Sumatra {
  if (Test-Path $SumatraExe) { return }
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Tisková stanice potřebuje 64bitová Windows.' }
  $zip = Join-Path $env:TEMP 'shanon-sumatra.zip'
  Invoke-WebRequest -Uri $SumatraUrl -OutFile $zip -UseBasicParsing
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $SumatraSha) { Remove-Item $zip -Force; throw 'Stažený SumatraPDF nesouhlasí (kontrolní součet) — instalaci zopakujte.' }
  $dir = Join-Path $AppDir 'SumatraPDF'
  New-Item -ItemType Directory -Force $dir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  Remove-Item $zip -Force
  $exe = Get-ChildItem $dir -Filter 'SumatraPDF*.exe' | Select-Object -First 1
  if ($exe.Name -ne 'SumatraPDF.exe') { Move-Item $exe.FullName $SumatraExe -Force }
}

function Stop-OldStation {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*ShanonPokladna*stanice.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Install-Station {
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  $icon = Join-Path $AppDir 'shanon.ico'
  [IO.File]::WriteAllBytes($icon, [Convert]::FromBase64String($SetupIcon))
  # program stanice bez párovacího kódu
  $self = [IO.File]::ReadAllText($PSCommandPath)
  $body = $self.Substring($self.IndexOf('#--AGENT--'))
  [IO.File]::WriteAllText((Join-Path $AppDir 'stanice.ps1'), $body, $Utf8Bom)

  $r = Invoke-Json 'POST' "$SetupUrl/api/station/pair" @{ code = $SetupPair; host = $env:COMPUTERNAME; version = $Version }
  $secure = ConvertTo-SecureString $r.token -AsPlainText -Force | ConvertFrom-SecureString
  $cfg = @{ url = $SetupUrl; deviceId = $r.deviceId; name = $r.name; token = $secure }
  [IO.File]::WriteAllText($ConfigPath, ($cfg | ConvertTo-Json), $Utf8Bom)

  Install-Sumatra

  # spouštění stanice bez okna: VBScript → PowerShell skrytě
  $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $vbs = Join-Path $AppDir 'stanice.vbs'
  $cmd = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $AppDir 'stanice.ps1') + '"'
  [IO.File]::WriteAllText($vbs, 'CreateObject("WScript.Shell").Run "' + $cmd.Replace('"', '""') + '", 0, False', [System.Text.Encoding]::ASCII)
  $wscript = "$env:SystemRoot\System32\wscript.exe"
  # starší názvy zástupců (Shanon Pokladna) pryč
  foreach ($f in @('Startup', 'Desktop', 'Programs')) { Get-ChildItem ([Environment]::GetFolderPath($f)) -Filter 'Shanon Pokladna*.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue }
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Startup')) 'Shanon - tisk.lnk') $wscript ('"' + $vbs + '"') $icon 7

  # zástupce aplikace (okno bez lišty prohlížeče, vlastní profil = vlastní přihlášení a ikona)
  $browser = Find-Browser
  $appArgs = '--app="' + "$SetupUrl/stanice?d=$($r.deviceId)" + '" --user-data-dir="' + (Join-Path $AppDir 'profil') + '" --start-maximized --no-first-run --no-default-browser-check'
  if ($browser) {
    New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Shanon.lnk') $browser $appArgs $icon 3
    New-Shortcut (Join-Path ([Environment]::GetFolderPath('Programs')) 'Shanon.lnk') $browser $appArgs $icon 3
  }

  Stop-OldStation
  Start-Process $wscript -ArgumentList ('"' + $vbs + '"')
  Write-Log "Instalace hotová, zařízení $($r.name)"
  $note = if ($browser) { 'Na ploše je zástupce Shanon. Tiskárny počítače najdete v Shanonu v Integrace → Zařízení.' } else { 'Nenašel jsem Microsoft Edge ani Google Chrome — zástupce aplikace se nevytvořil. Tisková stanice běží.' }
  Show-Message "Shanon je na počítači $($r.name) nainstalovaný.`n`n$note"
  if ($browser) { Start-Process $browser -ArgumentList $appArgs }
}

function Read-Config {
  $c = [IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(($c.token | ConvertTo-SecureString))
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  return @{ url = $c.url.TrimEnd('/'); headers = @{ Authorization = "Bearer $token" } }
}

# stav tiskárny podle Windows (Win32_Printer: PrinterStatus, DetectedErrorState, WorkOffline)
function Get-PrinterState($P) {
  $e = [int]$P.DetectedErrorState; $s = [int]$P.PrinterStatus
  if ($P.WorkOffline -or $s -eq 7 -or $e -eq 9) { return 'offline' }
  switch ($e) { 4 { return 'noPaper' } 3 { return 'lowPaper' } 8 { return 'jammed' } 7 { return 'doorOpen' } 5 { return 'toner' } 6 { return 'toner' } 10 { return 'error' } 11 { return 'error' } }
  if ($s -eq 4) { return 'printing' }
  if ($s -eq 3) { return 'ready' }
  return 'unknown'
}

function Send-Hello($Cfg) {
  $queue = @(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue)
  $printers = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | ForEach-Object {
    $n = $_.Name
    @{ name = $n; default = [bool]$_.Default; state = (Get-PrinterState $_); queued = @($queue | Where-Object { $_.Name -like "$n,*" }).Count; driver = [string]$_.DriverName }
  })
  # USB tiskárny bez tiskárny ve Windows (chybí ovladač): tisková třída USBPRINT, nebo USB zařízení bez ovladače (kód 28) s názvem tiskárny
  $usb = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
    ($_.PNPDeviceID -like 'USBPRINT\*') -or ($_.PNPDeviceID -like 'USB\*' -and $_.ConfigManagerErrorCode -eq 28 -and $_.Name -match 'print|tisk|tm-|pos|receipt|thermal|epson|star|xprinter|citizen|bixolon|zebra')
  } | ForEach-Object { [string]$_.Name } | Where-Object { $_ } | Select-Object -Unique -First 10)
  [void](Invoke-Json 'POST' "$($Cfg.url)/api/station/hello" @{ host = $env:COMPUTERNAME; version = $Version; printers = $printers; usb = $usb } $Cfg.headers)
}

# sdílená tiskárna z katalogu firmy (\\server\tiskárna): připojit ve Windows (ovladač dá server tiskárny), výsledek do Shanonu
function Connect-SharedPrinter($Cfg, [string]$Path) {
  $ok = $true
  $msg = ''
  try {
    if ($Path -notmatch '^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|]+$') { throw 'neplatná cesta' }
    if (-not (Get-Printer -Name $Path -ErrorAction SilentlyContinue)) { Add-Printer -ConnectionName $Path -ErrorAction Stop }
    Write-Log "Připojena tiskárna $Path"
  } catch {
    $ok = $false
    $msg = $_.Exception.Message
    Write-Log "Připojení tiskárny $($Path): $msg"
  }
  try { [void](Invoke-Json 'POST' "$($Cfg.url)/api/station/connect" @{ path = $Path; ok = $ok; message = $msg } $Cfg.headers) } catch { }
}

function Print-Job($Cfg, $Job) {
  $file = Join-Path $env:TEMP ("shanon-" + $Job.id + ".pdf")
  try {
    $resp = Invoke-WebRequest -Uri "$($Cfg.url)/api/station/jobs/$($Job.id)/pdf" -Headers $Cfg.headers -OutFile $file -PassThru -UseBasicParsing -TimeoutSec 60
    $settings = [string]$resp.Headers['X-Print-Settings']
    $argv = @('-silent', '-exit-when-done')
    if ($Job.printer) { $argv += @('-print-to', ('"' + $Job.printer + '"')) } else { $argv += '-print-to-default' }
    if ($settings) { $argv += @('-print-settings', ('"' + $settings + '"')) }
    $argv += ('"' + $file + '"')
    $p = Start-Process -FilePath $SumatraExe -ArgumentList $argv -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0) { throw "SumatraPDF skončil s kódem $($p.ExitCode) (tiskárna `"$($Job.printer)`" existuje?)" }
    [void](Invoke-Json 'POST' "$($Cfg.url)/api/station/jobs/$($Job.id)" @{ ok = $true } $Cfg.headers)
    Write-Log "Vytištěno $($Job.reference) → $($Job.printer)"
  } finally {
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}

function Start-Station {
  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Local\ShanonPokladnaStanice', [ref]$created)
  if (-not $created) { return }
  Write-Log "Stanice $Version spuštěna"
  $cfg = Read-Config
  if (-not (Test-Path $SumatraExe)) { try { Install-Sumatra } catch { Write-Log "SumatraPDF: $($_.Exception.Message)" } }
  $nextHello = Get-Date
  $update = $false
  while (-not $update) {
    try {
      if ((Get-Date) -ge $nextHello) { Send-Hello $cfg; $nextHello = (Get-Date).AddMinutes(10) }
      $r = Invoke-Json 'GET' "$($cfg.url)/api/station/jobs?wait=25" $null $cfg.headers 45
      # Shanon chce stav tiskáren hned (Diagnostika → Obnovit stav)
      # Diagnostika → Připojit: sdílené tiskárny z katalogu firmy, pak hned nové hlášení tiskáren
      $wanted = @($r.connect | Where-Object { $_ })
      foreach ($p in $wanted) { Connect-SharedPrinter $cfg ([string]$p) }
      if ($r.hello -or $wanted.Count) { Send-Hello $cfg; $nextHello = (Get-Date).AddMinutes(10) }
      # novější program stanice v Shanonu → stáhnout, nahradit a spustit znovu
      if ($r.agent -and ([version]$r.agent -gt [version]$Version)) { $update = Update-Agent $cfg ([string]$r.agent) }
      foreach ($job in @($r.jobs)) {
        try { Print-Job $cfg $job }
        catch {
          $msg = $_.Exception.Message
          Write-Log "Chyba tisku $($job.reference): $msg"
          try { [void](Invoke-Json 'POST' "$($cfg.url)/api/station/jobs/$($job.id)" @{ ok = $false; message = $msg } $cfg.headers) } catch { }
        }
      }
    } catch {
      $code = $null
      try { $code = [int]$_.Exception.Response.StatusCode } catch { }
      if ($code -eq 401) { Write-Log 'Stanice je v Shanonu odpojená — stáhněte instalaci znovu.'; Start-Sleep -Seconds 300 }
      else { Write-Log "Spojení: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
    }
  }
  # aktualizace: uvolnit zámek a spustit novou verzi (skrytě přes stanice.vbs)
  $mutex.ReleaseMutex(); $mutex.Dispose()
  Start-Process "$env:SystemRoot\System32\wscript.exe" -ArgumentList ('"' + (Join-Path $AppDir 'stanice.vbs') + '"')
}

# stáhne program stanice ze Shanonu a nahradí stanice.ps1; true = spustit znovu
function Update-Agent($Cfg, [string]$Want) {
  $tmp = Join-Path $AppDir 'stanice.new.ps1'
  try {
    Invoke-WebRequest -Uri "$($Cfg.url)/api/station/agent" -Headers $Cfg.headers -OutFile $tmp -UseBasicParsing -TimeoutSec 60 | Out-Null
    $text = [IO.File]::ReadAllText($tmp)
    if (-not $text.Contains('#--AGENT--') -or -not $text.Contains("`$Version = '$Want'")) { throw 'stažený program není platný' }
    Move-Item $tmp (Join-Path $AppDir 'stanice.ps1') -Force
    Write-Log "Aktualizace stanice $Version → $Want"
    return $true
  } catch {
    Write-Log "Aktualizace se nepovedla: $($_.Exception.Message)"
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

if ($SetupPair) {
  try { Install-Station }
  catch {
    Write-Log "Instalace selhala: $($_.Exception.Message)"
    Show-Message "Instalace se nepovedla:`n$($_.Exception.Message)" 'Error'
    exit 1
  }
} else {
  Start-Station
}
