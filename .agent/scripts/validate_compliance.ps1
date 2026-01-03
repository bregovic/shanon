# SHANON COMPLIANCE CHECKER
# Tento skript ověřuje, zda kód splňuje pravidla definovaná v MANIFEST.md.
# Spouští se automaticky před nasazením.

param (
    [string]$RootPath = "..\.." # Relative to .agent/scripts
)

$ErrorCount = 0
$WarningCount = 0

Write-Host "--- SHANON COMPLIANCE CHECK ---" -ForegroundColor Cyan

# 1. KONTROLA MIGRACÍ (SQL Schema Standards)
Write-Host "1. Checking Migrations (Schema Standards)..."
$MigrationFiles = Get-ChildItem -Path "$RootPath\backend\migrations" -Filter "*.sql" -Recurse -ErrorAction SilentlyContinue

foreach ($file in $MigrationFiles) {
    $content = Get-Content $file.FullName
    
    # Pokud je to CREATE TABLE, musí mít TenantId a RecId
    if ($content -match "CREATE TABLE") {
        if ($content -notmatch "TenantId") {
            Write-Host "[ERROR] $($file.Name): Missing 'TenantId' column!" -ForegroundColor Red
            $ErrorCount++
        }
        if ($content -notmatch "RecId") {
            Write-Host "[ERROR] $($file.Name): Missing 'RecId' PK!" -ForegroundColor Red
            $ErrorCount++
        }
        if ($content -notmatch "CreatedBy" -or $content -notmatch "ModifiedBy") {
            Write-Host "[WARNING] $($file.Name): Missing Audit fields (CreatedBy/ModifiedBy)." -ForegroundColor Yellow
            $WarningCount++
        }
    }
}

# 2. KONTROLA HARDCODED STRINGŮ (UI Labels)
Write-Host "2. Checking UI Labels..."
$UiFiles = Get-ChildItem -Path "$RootPath\client\src" -Include "*.tsx", "*.ts" -Recurse -ErrorAction SilentlyContinue

foreach ($file in $UiFiles) {
    $content = Get-Content $file.FullName
    # Hledáme texty v uvozovkách uvnitř JSX, které nevypadají jako Label ID (@...)
    # Toto je zjednodušená heuristika
    foreach ($line in $content) {
        if ($line -match ">[A-Z][a-z]+<") { # Např. <Button>Save</Button>
            Write-Host "[WARNING] $($file.Name): Potential hardcoded text found: '$($matches[0])'. Use Label::get()." -ForegroundColor Yellow
            $WarningCount++
            break # Stačí jedno varování na soubor
        }
    }
}

# 3. KONTROLA DOCKER KONFIGURACE
Write-Host "3. Checking Docker Config..."
if (-not (Test-Path "$RootPath\Dockerfile")) {
    Write-Host "[ERROR] Dockerfile missing! Source code protection not ensured." -ForegroundColor Red
    $ErrorCount++
}

# VÝSLEDEK
Write-Host "--- CHECK COMPLETE ---"
Write-Host "Errors: $ErrorCount" -ForegroundColor ($ErrorCount > 0 ? "Red" : "Green")
Write-Host "Warnings: $WarningCount" -ForegroundColor ($WarningCount > 0 ? "Yellow" : "Green")

if ($ErrorCount -gt 0) {
    Write-Host "DEPLOYMENT ABORTED. Fix critical errors first." -ForegroundColor Red
    exit 1
} else {
    Write-Host "COMPLIANCE PASSED. Proceeding to deployment." -ForegroundColor Green
    exit 0
}
