# SHANON PROJECT MANIFEST
> Core principles and coding standards.

## 1. Architektura a Design
- **Žádné "divoké" fallbacky:** Kód nesmí tiše obcházet chyby (např. vytvářet tabulky za běhu bez evidence). Všechny změny struktury musí jít přes migrace.
- **Evidence technického dluhu:** Veškerá dočasná funkcionalita, "hacky" nebo testovací funkce musí být evidovány v systému (tabulka `sys_technical_debt`).
- **Historie změn:** Každý deploy, migrace nebo významná změna musí být zalogována v `development_history`.

## 2. Best Practices
- **Databáze:**
  - Všechny změny přes `install-db.php` (migrace).
  - Žádné přímé `CREATE TABLE` v aplikačním kódu (API).
- **Frontend:**
  - Fluent UI v9 komponenty.
  - Žádné inline styly pokud existuje systémové řešení.

## 3. Workflow
- Před nasazením "špinavého" řešení (hotfix) je nutné vytvořit záznam v `sys_technical_debt`.
- Agent musí při ukončení práce zkontrolovat, zda po sobě nezanechal neevidovaný dluh.
