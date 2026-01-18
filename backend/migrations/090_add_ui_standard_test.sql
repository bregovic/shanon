DO $$
DECLARE
    scenario_id INTEGER;
BEGIN
    -- Vytvoření testovacího scénáře
    INSERT INTO sys_test_scenarios (tenant_id, title, description, category, created_by)
    VALUES ('00000000-0000-0000-0000-000000000001', 'UI Consistency Standard Check', 'Ověření, zda modul dodržuje UI standardy definované v FORM_STANDARD.md (SmartDataGrid, Drawer, ActionBar)', 'process', 'System')
    RETURNING rec_id INTO scenario_id;

    -- Krok 1: Grid
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 1, 'Přejděte na seznam entit (např. Uživatelé, DMS)', 'Stránka se načte a obsahuje komponentu SmartDataGrid.');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 2, 'Zkontrolujte výběr řádků', 'Jsou přítomny ckeckboxy (multiselect) a kliknutí na řádek jej vybere.');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 3, 'Zkontrolujte interakci (Double Click)', 'Dvojklik na řádek otevře detail/editaci (Drawer).');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 4, 'Ověřte ActionBar', 'Nad tabulkou je ActionBar s tlačítky (Nový, Obnovit, Smazat) se správnými ikonami.');

    -- Krok 2: Drawer
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 5, 'Klikněte na "Nový" nebo upravte položku', 'Otevře se Drawer (panel) z pravé strany.');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 6, 'Zkontrolujte hlavičku Draweru', 'Obsahuje jasný titulek a tlačítko zavřít (X).');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 7, 'Zkontrolujte patičku/akce', 'Tlačítka Uložit (Primary) a Zrušit (Secondary) jsou dole.');

    -- Krok 3: Inputy
    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 8, 'Ověřte formulářová pole', 'Jsou použity Labels. Povinná pole jsou označena.');

    INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result)
    VALUES (scenario_id, 9, 'Ověřte validaci chyb', 'Chyby se zobrazují pomocí MessageBar (červený pruh).');

END $$;
