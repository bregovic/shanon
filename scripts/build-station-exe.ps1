# Sestavení instalátoru src/station/Shanon-instalace.exe (Windows, .NET Framework 4 — csc je v každých Windows).
#
#   powershell -File scripts/build-station-exe.ps1            # sestavit (nepodepsaný: Windows varuje „Neznámý vydavatel“)
#
# Podpis (jednou po sestavení, soubor je pro všechny stejný — server do něj nic nevkládá):
#   Azure Trusted Signing:  $env:SHANON_SIGN_DLIB = '…\Azure.CodeSigning.Dlib.dll'; $env:SHANON_SIGN_METADATA = '…\metadata.json'
#   certifikát na tokenu / v úložišti Windows:  $env:SHANON_SIGN_THUMBPRINT = '<otisk SHA1 certifikátu>'
# signtool je ze sady Windows SDK (Windows Kits\10\bin\<verze>\x64\signtool.exe).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$dir = Join-Path $root 'src\station\setup'
$out = Join-Path $root 'src\station\Shanon-instalace.exe'

npx tsx scripts/station-ico.ts
if ($LASTEXITCODE) { throw 'ikona se nevytvořila' }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$dir\shanon.ico" "/out:$out" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll "$dir\ShanonSetup.cs"
if ($LASTEXITCODE) { throw 'kompilace selhala' }

if ($env:SHANON_SIGN_DLIB -or $env:SHANON_SIGN_THUMBPRINT) {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName | Select-Object -Last 1
  if (-not $signtool) { throw 'signtool nenalezen (nainstalujte Windows SDK)' }
  $ts = 'http://timestamp.acs.microsoft.com'
  if ($env:SHANON_SIGN_DLIB) {
    & $signtool.FullName sign /v /fd SHA256 /tr $ts /td SHA256 /dlib $env:SHANON_SIGN_DLIB /dmdf $env:SHANON_SIGN_METADATA $out
  } else {
    & $signtool.FullName sign /v /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 /sha1 $env:SHANON_SIGN_THUMBPRINT $out
  }
  if ($LASTEXITCODE) { throw 'podpis selhal' }
}
Get-Item $out | Select-Object Name, Length, LastWriteTime
