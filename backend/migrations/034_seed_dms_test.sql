-- Migration: 034_seed_dms_test.sql
-- Description: Inserts a default 'End-to-End DMS Process' test scenario

DO $$
DECLARE
    lid integer;
    tid uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- 1. Create Scenario Header
    INSERT INTO sys_test_scenarios (tenant_id, title, description, category, priority, created_by)
    VALUES (
        tid,
        'DMS: Standardní proces zpracování faktury',
        'Ověření kompletního toku dokumentu: Nahrání -> OCR -> Revize -> Schválení. Cílem je potvrdit, že systém správně vytěží data a umožní jejich validaci.',
        'process',
        'high',
        'System Installer'
    )
    RETURNING rec_id INTO lid;

    -- 2. Add Steps

    -- Step 1: Import
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 1, 'Přejděte do "Integrace -> Import dokumentů". Nahrajte testovací PDF fakturu pomocí Drag & Drop nebo výběrem souboru. Zvolte typ dokumentu "Faktura přijatá".', 'Soubor se úspěšně nahraje. Zobrazí se hláška o úspěchu. Dokument je viditelný v seznamu.');

    -- Step 2: OCR Trigger
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 2, 'Přejděte do "Dokumenty -> Revize (OCR)". Zkontrolujte, zda je nově nahraný dokument ve frontě.', 'Dokument je v seznamu. Stav OCR je "pending" nebo "processing". Po chvíli se status změní na "mapping" nebo "completed".');

    -- Step 3: Visual Review
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 3, 'Klikněte na dokument pro otevření detailu revize. Ověřte, že se vlevo načetl náhled dokumentu (obrázek).', 'Náhled dokumentu je čitelný. Zobrazovací nástroje (zoom) fungují.');

    -- Step 4: Data Verification
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 4, 'Zkontrolujte vytěžená data v pravém panelu (Číslo faktury, Částka, Datum). Pokud data chybí, použijte myš pro označení oblasti na faktře (Zónování).', 'Systém správně doplní hodnotu z označené oblasti do vybraného pole formuláře.');

    -- Step 5: Save Changes
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 5, 'Proveďte drobnou změnu v datech (např. upravte popis) a klikněte na tlačítko "Uložit (Rozpracováno)".', 'Změny jsou uloženy. Aplikace nevykazuje chybu. Stav dokumentu zůstává otevřený pro další úpravy.');

    -- Step 6: Final Approval
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (lid, 6, 'Klikněte na tlačítko "Schválit".', 'Dokument zmizí z fronty k revizi (nebo se označí jako hotový). V seznamu "Všechny dokumenty" má stav "Verified" (Schváleno).');

END $$;
