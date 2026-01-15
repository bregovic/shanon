# Standardy Projektu Shanon

Tento dokument definuje klíčová pravidla pro vývoj a údržbu projektu Shanon.

## 1. Release History (Historie verzí)
**Pravidlo:** Každá významná změna (nová feature, fix kritické chyby, refactoring DB) musí být zaznamenána.
- Kde: Databázová tabulka `development_history`.
- Jak: Frontend má sekci "Historie změn" (Systém -> Docs).
- **Agent Context:** AI by měla při dokončení tasku navrhnout záznam do historie, nebo ho rovnou vytvořit přes SQL migraci, pokud je to vhodné.

## 2. Testovací Scénáře (QA)
**Pravidlo:** Pro každý nový modul nebo kritický proces (např. DMS upload, OCR) musí existovat definovaný testovací scénář.
- Kde: Tabulky `sys_test_scenarios`, `sys_test_steps`.
- Modul: Systém -> Testování (QA).
- **Proces:**
    1. Definovat scénář (název, popis).
    2. Rozepsat kroky (Step 1, Step 2...).
    3. Při releasu manuálně projít scénář a zaznamenat výsledek (Pass/Fail).

## 3. UI Standardy (Formuláře)
**Pravidlo:** Všechny administrační formuláře a konfigurace musí používat jednotný layout.
- Komponenta: `MenuSection` (pro sbalovací sekce).
- Chování: Sekce by měly být defaultně rozbalené (pokud není uvedeno jinak).
- Statusy: Používat `Badge` (Fluent UI) pro vizualizaci stavů (Success/Danger).

## 4. Backend & Security
- Debug skripty (`debug_*.php`) nesmí zůstat na produkci bez zabezpečení.
- Citlivé akce vyžadují kontrolu oprávnění (`$_SESSION['loggedin']`).
