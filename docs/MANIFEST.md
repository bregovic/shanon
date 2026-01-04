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
  - **Mobile First & Responsivita:** 
    - Všechny UI layouty musí být optimalizovány pro mobilní zařízení.
    - **Header & Navigace:** Na mobilu preferujeme "Unified Horizontal Scroll" (celý řádek s logem i akcemi se posouvá) před skrýváním prvků.
    - **Dashboardy & Sloupce:** Používat `scroll-snap` a horizontální posun pro sekce, místo nekonečného vertikálního stackování.
    - **Žádné skákání:** Layout musí být stabilní při expanzi/kolapsu sekcí.
  - **Dashboard UI Standard:**
    - **Akční lišta (ActionBar):** Globální akce (Refresh, Expand/Collapse) musí být v `ActionBar` (vpravo).
    - **Expand/Collapse:** Pokud má modul sekce, tlačítka "Expand all" a "Collapse all" jsou v Action Baru nalevo od "Obnovit" jako `appearance="subtle"`.
    - **Layout:** Obsah začíná ihned pod hlavičkou/drobečky, bez zbytečného toolbaru v těle stránky.

## 3. Workflow
- Před nasazením "špinavého" řešení (hotfix) je nutné vytvořit záznam v `sys_technical_debt`.
- Agent musí při ukončení práce zkontrolovat, zda po sobě nezanechal neevidovaný dluh.
