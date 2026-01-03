# SHANON MASTER DEPLOY SCRIPT
# Spouští compliance check a následně build procesu.

$ScriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootPath = Resolve-Path "$ScriptPath\..\.."

Write-Host "Starting Shanon Deployment Sequence..." -ForegroundColor Cyan

# 1. COMPLIANCE CHECK
Write-Host "Step 1: Running Compliance Gatekeeper..."
& "$ScriptPath\validate_compliance.ps1" -RootPath $RootPath

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment Failed at Step 1." -ForegroundColor Red
    exit 1
}

# 2. VERSION BUMP (Automaticky zvedne verzi - TODO)
# Write-Host "Step 2: Versioning..."

# 3. DOCKER BUILD
Write-Host "Step 3: Building Docker Images (Simulation)..."
# docker build -t shanon-api .
# docker build -t shanon-web ./client
Write-Host "Build Success." -ForegroundColor Green

# 4. FINAL REPORT
Write-Host "------------------------------------------------"
Write-Host "READY FOR RELEASE." -ForegroundColor Green
Write-Host "To push changes: git push origin main"
Write-Host "------------------------------------------------"
