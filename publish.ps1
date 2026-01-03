# SHANON PUBLISH SCRIPT
# Tento skript bezpečně odešle změny do Gitu (a tím spustí Railway).

param (
    [string]$Message = "" 
)

# 1. Spustit Compliance Check (Policajt)
Write-Host "🔍 Spouštím kontrolu kvality (Compliance)..." -ForegroundColor Cyan
try {
    & "$PSScriptRoot\.agent\scripts\validate_compliance.ps1" -RootPath "$PSScriptRoot"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Chyba: Kód nesplňuje standardy (viz výše). Opravte chyby a zkuste to znovu." -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "⚠️ Warning: Compliance skript nenalezen, pokračuji s opatrností." -ForegroundColor Yellow
}

# 2. Získat zprávu pro commit
if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = Read-Host "✍️ Popište, co jste změnil (Commit message)"
    if ([string]::IsNullOrWhiteSpace($Message)) {
        Write-Host "❌ Chyba: Popis změny je povinný!" -ForegroundColor Red
        exit 1
    }
}

# 3. Git Operace
Write-Host "📦 Balím a odesílám změny..." -ForegroundColor Cyan

# Používáme try/catch pro zachycení chyb Gitu
try {
    # Stáhnout novinky (prevence konfliktů)
    Write-Host "⬇️ Stahuji aktuální změny ze serveru..."
    git pull origin main
    
    # Přidat vše
    git add .
    
    # Commit
    git commit -m "$Message"
    
    # Push
    Write-Host "🚀 Odesílám na GitHub (Railway provede deploy)..." -ForegroundColor Green
    git push -u origin main
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ HOTOVO! Nová verze je na cestě." -ForegroundColor Green
    }
    else {
        Write-Host "❌ Chyba při odesílání. Zkontrolujte připojení nebo přihlášení." -ForegroundColor Red
    }
}
catch {
    Write-Host "❌ Kritická chyba Gitu: $_" -ForegroundColor Red
}
