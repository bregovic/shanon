DO $$ 
BEGIN 
    -- A. Převod existujících ÚČTOVANÝCH ORGANIZACÍ (sys_organizations) na GAB Subjekty
    INSERT INTO gab_subjects (tenant_id, name, reg_no, tax_no, is_active, created_by)
    SELECT tenant_id, display_name, reg_no, tax_no, is_active, 'Migration Script' 
    FROM sys_organizations 
    WHERE gab_subject_id IS NULL;

    -- Zpětný update sys_organizations (Nastavení FK klíče)
    UPDATE sys_organizations SET gab_subject_id = s.rec_id 
    FROM gab_subjects s 
    WHERE sys_organizations.tenant_id = s.tenant_id 
      AND sys_organizations.display_name = s.name 
      AND sys_organizations.gab_subject_id IS NULL;

    -- Vytvoření Roli INTERNAL_ORG
    INSERT INTO gab_subject_roles (tenant_id, subject_id, role_code)
    SELECT tenant_id, gab_subject_id, 'INTERNAL_ORG' 
    FROM sys_organizations 
    WHERE gab_subject_id IS NOT NULL 
    ON CONFLICT DO NOTHING;

    -- B. Převod existujících UŽIVATELŮ (sys_users) na GAB Subjekty
    INSERT INTO gab_subjects (tenant_id, name, is_active, created_by)
    SELECT tenant_id, full_name, (CASE WHEN role = 'BANNED' THEN false ELSE true END), 'Migration Script' 
    FROM sys_users 
    WHERE gab_subject_id IS NULL AND full_name IS NOT NULL AND full_name != '';

    -- Zpětný update sys_users
    UPDATE sys_users SET gab_subject_id = s.rec_id 
    FROM gab_subjects s 
    WHERE sys_users.tenant_id = s.tenant_id 
      AND sys_users.full_name = s.name 
      AND sys_users.gab_subject_id IS NULL;

    -- Vytvoření Roli EMPLOYEE
    INSERT INTO gab_subject_roles (tenant_id, subject_id, role_code)
    SELECT tenant_id, gab_subject_id, 'EMPLOYEE' 
    FROM sys_users 
    WHERE gab_subject_id IS NOT NULL 
    ON CONFLICT DO NOTHING;

    -- Migrace emailů z uživatelů jako Kontaktů
    INSERT INTO gab_contacts (tenant_id, subject_id, contact_type, contact_value, is_primary)
    SELECT tenant_id, gab_subject_id, 'EMAIL', email, true 
    FROM sys_users 
    WHERE gab_subject_id IS NOT NULL AND email IS NOT NULL AND email != ''
    ON CONFLICT DO NOTHING;

END $$;

-- Zapsat změnu do historie vývoje pro Release Notes
INSERT INTO development_history (date, title, description, category, created_at)
SELECT CURRENT_DATE, 'Modul: Správa Organizace (GAB)', 'Nasazeno jádro Globálního adresáře. Existující organizace a uživatelé byli úspěšně zpětně provázáni jako GAB subjekty.', 'Feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Modul: Správa Organizace (GAB)' AND date = CURRENT_DATE);
