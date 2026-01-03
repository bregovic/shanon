# STANDARD OPERATING PROCEDURES (SOP)
> **Role:** Tento dokument slouží jako "Checklist" pro AI agenty a vývojáře. Před každým commitem ověř, zda byly splněny tyto body.

## A. Přidání Nové Entity (Tabulky)
Pokud vytváříš novou tabulku (např. `SalesTable`), ověř:
1.  [ ] **Schema:** Má sloupce `RecId` (PK), `DataAreaId`, `TenantId`, `VersionId`?
2.  [ ] **SysTableId:** Byla přidána konstanta do `SysTableId` enumu?
3.  [ ] **Audit:** Jsou přítomny `CreatedBy`, `CreatedDateTime`?
4.  [ ] **Security:** Byly vytvořeny základní privilegia (`SalesTableView`, `SalesTableEdit`)?

## B. Úprava Formuláře / UI
1.  [ ] **Labels:** Žádný text není natvrdo. Vše je přes `Label::get('@Shanon:MyText')`.
2.  [ ] **Personalizace:** Formulář dědí z `SysFormBase` a podporuje `SysUserSetup`?
3.  [ ] **Excel:** Funguje tlačítko "Export to Excel"?

## C. Zpracování Změn (Change Request)
1.  [ ] **ALM:** Má změna přidělené ID (např. CR-105)?
2.  [ ] **Commit:** Je zpráva ve formátu `feat(module): popis změn [CR-105]`?
3.  [ ] **Changelog:** Je změna uživatelsky viditelná? Pokud ano, přidej záznam do `RELEASE_NOTES_DRAFT.md`.
4.  [ ] **Help:** Vyžaduje změna aktualizaci nápovědy? Pokud ano, založ záznam v `SysHelpRef`.

## D. Nasazení (Deployment)
1.  [ ] **Docker:** Byla přidána nová knihovna? Pokud ano, aktualizuj `Dockerfile`.
2.  [ ] **Migrations:** Existuje migrační skript v `/migrations`? Je idempotentní (znovupoužitelný)?
3.  [ ] **Version:** Byl spuštěn `bump_version.ps1`?

---
*Tyto procedury zajišťují, že projekt Shanon zůstane Enterprise-Grade i po letech vývoje.*
