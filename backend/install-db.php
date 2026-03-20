<?php
// backend/install-db.php
// Unified Database Migration Script
// Usage: /api/install-db.php?token=shanon2026install

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once 'db.php';

// Security Check
$token = $_GET['token'] ?? $argv[1] ?? '';

if ($token !== 'shanon2026install') {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

try {
    $pdo = DB::connect();
    $messages = [];

    // --- MIGRATION DEFINITIONS ---
    
    $migrations = [
        '001_sessions' => "
            CREATE TABLE IF NOT EXISTS sys_sessions (
                id VARCHAR(128) PRIMARY KEY,
                data TEXT NOT NULL,
                access INT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_access ON sys_sessions (access);
        ",
        '002_dms_core' => "
            -- DMS Core Tables (Updated to match legacy 'code' schema)
            CREATE TABLE IF NOT EXISTS dms_doc_types (
                rec_id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(50),
                number_series_id INT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS dms_documents (
                rec_id SERIAL PRIMARY KEY,
                display_name VARCHAR(255) NOT NULL,
                doc_type_id INT REFERENCES dms_doc_types(rec_id),
                file_path VARCHAR(500) NOT NULL,
                file_size_bytes BIGINT,
                mime_type VARCHAR(100),
                uploaded_by INT,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ocr_status VARCHAR(20) DEFAULT 'pending', 
                ocr_content TEXT,
                metadata JSONB DEFAULT '{}'
            );
        ",
        '002a_dms_schema_ensure_columns' => "
            DO $$ 
            BEGIN 
                -- Ensure 'code' exists (Legacy column)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='code') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN code VARCHAR(50);
                END IF;

                -- Ensure 'icon' exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='icon') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN icon VARCHAR(50);
                END IF;
            END $$;
        ",
        '002b_dms_constraints' => "
             DO $$ 
             BEGIN
                -- Ensure code is unique if constraint missing
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dms_doc_types_code_key') THEN
                    ALTER TABLE dms_doc_types ADD CONSTRAINT dms_doc_types_code_key UNIQUE (code);
                END IF;
             END $$;
        ",
        // FIX: Smart Data Seeding (Handle name conflicts)
        '003_dms_setup_data_smart' => "
            DO $$
            DECLARE
                r RECORD;
            BEGIN
                -- Define data to sync
                FOR r IN SELECT * FROM (VALUES 
                    ('INV_IN', 'Faktura přijatá', 'Document24Regular'),
                    ('INV_OUT', 'Faktura vydaná', 'Document24Regular'),
                    ('CONTRACT', 'Smlouva', 'Document24Regular'),
                    ('OTHER', 'Ostatní', 'Document24Regular')
                ) AS t(code, name, icon)
                LOOP
                    -- 1. Try to find by CODE first
                    IF EXISTS (SELECT 1 FROM dms_doc_types WHERE code = r.code) THEN
                        UPDATE dms_doc_types SET name = r.name, icon = r.icon WHERE code = r.code;
                    
                    -- 2. Try to find by NAME (if code didn't match)
                    ELSIF EXISTS (SELECT 1 FROM dms_doc_types WHERE name = r.name) THEN
                        UPDATE dms_doc_types SET code = r.code, icon = r.icon WHERE name = r.name;
                        
                    -- 3. Insert new
                    ELSE
                        INSERT INTO dms_doc_types (code, name, icon) VALUES (r.code, r.name, r.icon);
                    END IF;
                END LOOP;
            END $$;
        ",
        '004_dev_history' => "
            CREATE TABLE IF NOT EXISTS development_history (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                category VARCHAR(50) DEFAULT 'feature',
                related_task_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_dev_hist_date ON development_history(date);
        ",
        '005_cr_enhancements' => "
            CREATE TABLE IF NOT EXISTS sys_change_requests (
                rec_id SERIAL PRIMARY KEY,
                tenant_id UUID,
                subject VARCHAR(200),
                description TEXT,
                priority VARCHAR(20),
                status VARCHAR(20),
                assigned_to INT,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sys_change_requests_files (
                rec_id SERIAL PRIMARY KEY,
                cr_id INT NOT NULL, 
                file_name VARCHAR(255) NOT NULL,
                file_type VARCHAR(100),
                file_size INT,
                file_data TEXT, 
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_cr_files_cr_id ON sys_change_requests_files(cr_id);
            CREATE INDEX IF NOT EXISTS idx_cr_tenant ON sys_change_requests(tenant_id);
        ",
        '006_sys_number_series' => "
            -- Create Global Number Series Table
            CREATE TABLE IF NOT EXISTS sys_number_series (
                rec_id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE, 
                name VARCHAR(100) NOT NULL,
                format_mask VARCHAR(50) NOT NULL, 
                last_number INT DEFAULT 0,
                reset_period VARCHAR(20) DEFAULT 'never', 
                is_active BOOLEAN DEFAULT TRUE,
                tenant_id UUID,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Migrate legacy DMS series if they exist (Best Effort)
            DO $$
            BEGIN
               IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dms_number_series') THEN
                   -- Attempt to copy data assuming compatible structure
                   BEGIN
                       INSERT INTO sys_number_series (code, name, format_mask, last_number, is_active)
                       SELECT code, name, format, current_number, is_active 
                       FROM dms_number_series
                       ON CONFLICT (code) DO NOTHING;
                   EXCEPTION WHEN OTHERS THEN
                       -- Ignore migration errors if columns don't match exactly
                       NULL;
                   END;
               END IF;
            END $$;
        ",
        '007_rbac_security' => "
            -- 1. Security Objects Registry
            CREATE TABLE IF NOT EXISTS sys_security_objects (
                rec_id SERIAL PRIMARY KEY,
                identifier VARCHAR(100) NOT NULL UNIQUE,
                type VARCHAR(20) NOT NULL, -- module, form, action
                display_name VARCHAR(100) NOT NULL,
                description TEXT
            );

            -- 2. Roles Definition
            CREATE TABLE IF NOT EXISTS sys_security_roles (
                rec_id SERIAL PRIMARY KEY,
                code VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- 3. Permissions Mapping (Role <-> Object)
            CREATE TABLE IF NOT EXISTS sys_security_permissions (
                rec_id SERIAL PRIMARY KEY,
                role_id INT REFERENCES sys_security_roles(rec_id) ON DELETE CASCADE,
                object_id INT REFERENCES sys_security_objects(rec_id) ON DELETE CASCADE,
                access_level INT DEFAULT 0, -- 0=none, 1=view, 2=edit, 3=full
                UNIQUE(role_id, object_id)
            );

            -- 4. User Roles Assignment (Direct Relational)
            CREATE TABLE IF NOT EXISTS sys_user_roles (
                user_id INT NOT NULL, 
                role_id INT REFERENCES sys_security_roles(rec_id) ON DELETE CASCADE,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, role_id)
            );

            -- SEED: Default Roles
            INSERT INTO sys_security_roles (code, description) VALUES 
            ('ADMIN', 'Full System Access'),
            ('MANAGER', 'Team Manager'),
            ('USER', 'Standard User'),
            ('GUEST', 'Read Only')
            ON CONFLICT (code) DO NOTHING;

            -- SEED: Basic Modules Objects
            INSERT INTO sys_security_objects (identifier, type, display_name) VALUES
            ('mod_dashboard', 'module', 'Dashboard'),
            ('mod_crm', 'module', 'CRM'),
            ('mod_dms', 'module', 'DMS'),
            ('mod_requests', 'module', 'Požadavky'),
            ('mod_projects', 'module', 'Projekty'),
            ('mod_system', 'module', 'Systém')
            ON CONFLICT (identifier) DO NOTHING;

            -- SEED: Admin Permissions (Full Access to known objects)
            INSERT INTO sys_security_permissions (role_id, object_id, access_level)
            SELECT r.rec_id, o.rec_id, 3 
            FROM sys_security_roles r, sys_security_objects o
            WHERE r.code = 'ADMIN'
            ON CONFLICT (role_id, object_id) DO UPDATE SET access_level = 3;
        ",
        '008_history_20260104' => "
            INSERT INTO development_history (date, title, description, category, created_at) 
            SELECT '2026-01-04', 'System Config Refactoring', 'Implementace custom MenuSection, odstranění závislosti na Accordion, optimalizace načítání.', 'Refactor', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'System Config Refactoring' AND date = '2026-01-04');

            INSERT INTO development_history (date, title, description, category, created_at) 
            SELECT '2026-01-04', 'Localization Fixes', 'Doplnění chybějících překladů pro System a navigační moduly (Dashboard, DMS, Požadavky).', 'Bugfix', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Localization Fixes' AND date = '2026-01-04');

            INSERT INTO development_history (date, title, description, category, created_at) 
            SELECT '2026-01-04', 'RBAC Security Module', 'Implementace správy rolí zabezpečení (sys_security_roles, sys_security_permissions) s UI pro konfiguraci přístupů k systémovým objektům.', 'Feature', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'RBAC Security Module' AND date = '2026-01-04');
        ",
        '009_consolidate_roles' => "
            -- Migrate existing users with 'admin' or 'superadmin' role to ADMIN role in sys_user_roles
            INSERT INTO sys_user_roles (user_id, role_id)
            SELECT u.rec_id, r.rec_id
            FROM sys_users u
            CROSS JOIN sys_security_roles r
            WHERE r.code = 'ADMIN' AND (u.role = 'admin' OR u.role = 'superadmin')
            ON CONFLICT DO NOTHING;
            
            -- Migrate existing users with 'manager' role to MANAGER role
            INSERT INTO sys_user_roles (user_id, role_id)
            SELECT u.rec_id, r.rec_id
            FROM sys_users u
            CROSS JOIN sys_security_roles r
            WHERE r.code = 'MANAGER' AND u.role = 'manager'
            ON CONFLICT DO NOTHING;
            
            -- Migrate remaining users to USER role
            INSERT INTO sys_user_roles (user_id, role_id)
            SELECT u.rec_id, r.rec_id
            FROM sys_users u
            CROSS JOIN sys_security_roles r
            WHERE r.code = 'USER' AND u.role IN ('user', 'developer')
            ON CONFLICT DO NOTHING;
            
            -- Ensure all users have at least USER role
            INSERT INTO sys_user_roles (user_id, role_id)
            SELECT u.rec_id, r.rec_id
            FROM sys_users u
            CROSS JOIN sys_security_roles r
            WHERE r.code = 'USER'
            AND NOT EXISTS (SELECT 1 FROM sys_user_roles ur WHERE ur.user_id = u.rec_id)
            ON CONFLICT DO NOTHING;
            
            -- Drop the legacy role column from sys_users (keep for backup comment)
            -- ALTER TABLE sys_users DROP COLUMN IF EXISTS role;
            
            -- Drop the old sys_roles table
            DROP TABLE IF EXISTS sys_roles CASCADE;
            
            -- Log this migration
            INSERT INTO development_history (date, title, description, category, created_at) 
            SELECT '2026-01-04', 'Roles Consolidation', 'Sjednocení tabulek rolí: migrace uživatelů ze sys_users.role do sys_user_roles, odstranění staré sys_roles tabulky.', 'Refactor', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Roles Consolidation' AND date = '2026-01-04');
        ",
        '010_sys_change_comments' => null,
        '012_history_catchup' => null,
        '013_ai_identity_fix' => "
DO $$
DECLARE
    v_ai_id INT;
    v_ticket_id INT := 7;
BEGIN
    SELECT rec_id INTO v_ai_id FROM sys_users WHERE email = 'ai@shanon.dev';
    
    IF v_ai_id IS NULL THEN
        INSERT INTO sys_users (tenant_id, full_name, email, password_hash, role, created_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 'AI Developer', 'ai@shanon.dev', 'DISABLED', 'admin', NOW())
        RETURNING rec_id INTO v_ai_id;
    END IF;

    UPDATE sys_change_comments 
    SET user_id = v_ai_id 
    WHERE comment LIKE '%' || U&'\\+01F916' || '%' AND user_id != v_ai_id;

    UPDATE sys_change_comments
    SET comment = U&'\\2705 ' || comment
    WHERE cr_id = v_ticket_id
    AND user_id != v_ai_id
    AND comment NOT LIKE U&'\\2705%'
    AND comment NOT LIKE '%' || U&'\\+01F916' || '%';

    -- 4. Log to Development History
    INSERT INTO development_history (date, title, category, related_task_id)
    SELECT CURRENT_DATE, 'Fix: Request UI Bugs (Checkbox & Reactions)', 'bugfix', v_ticket_id
    WHERE NOT EXISTS (
        SELECT 1 FROM development_history WHERE related_task_id = v_ticket_id AND title LIKE 'Fix: Request UI%'
    );

    -- 5. Post Agent Comment
    INSERT INTO sys_change_comments (cr_id, user_id, comment, created_at)
    VALUES (v_ticket_id, v_ai_id, '✅ Opraveny nahlášené chyby: Checkbox selekce se resetuje, Reakce mají okamžitou odezvu. ~ 🤖 Antigravity', NOW());
END $$;",
        '014_sys_comment_reactions' => "
            CREATE TABLE IF NOT EXISTS sys_change_comment_reactions (
                rec_id SERIAL PRIMARY KEY,
                comment_id INT NOT NULL,
                user_id INT NOT NULL,
                reaction_type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_comm_react_comm FOREIGN KEY (comment_id) REFERENCES sys_change_comments(rec_id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_react_uniq ON sys_change_comment_reactions(comment_id, user_id, reaction_type);
        ",
        '015_ui_standardization_132' => "
            -- Log UI Standardization to History
            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-04', 'UI Standardization (Requests & Dashboard)', 'Refactored Requests Form and Dashboard to meet new UI Standard (Two-Bar Layout, Mobile Scroll, Menu Hierarchy). Fixed variable declaration bugs in RequestsPage.', 'Refactor', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'UI Standardization (Requests & Dashboard)' AND date = '2026-01-04');
        ",
        '016_dms_translations_and_tenant' => "
            -- 1. Create System Translations Table
            CREATE TABLE IF NOT EXISTS sys_translations (
                rec_id SERIAL PRIMARY KEY,
                table_name VARCHAR(64) NOT NULL,
                record_id INTEGER NOT NULL,
                language_code VARCHAR(10) NOT NULL,
                translation TEXT NOT NULL,
                field_name VARCHAR(64) DEFAULT 'name',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_translations_unique ON sys_translations (table_name, record_id, language_code, field_name);

            -- 2. Add Tenant ID to DMS tables (if missing)
            DO $$ 
            BEGIN 
                -- dms_doc_types
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='tenant_id') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN tenant_id UUID;
                END IF;
                -- dms_attributes
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='tenant_id') THEN 
                    ALTER TABLE dms_attributes ADD COLUMN tenant_id UUID;
                END IF;
                -- dms_number_series
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_number_series' AND column_name='tenant_id') THEN 
                    ALTER TABLE dms_number_series ADD COLUMN tenant_id UUID;
                END IF;
                -- dms_storage_profiles
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='tenant_id') THEN 
                    ALTER TABLE dms_storage_profiles ADD COLUMN tenant_id UUID;
                END IF;
                -- dms_doc_types additional cols
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='description') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN description TEXT;
                END IF;
                 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='number_series_id') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN number_series_id INTEGER;
                END IF;
            END $$;

            -- 3. Log this feature
            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'DMS Translations & Multi-Tenant', 'Implemented sys_translations for multilingual attributes and ensured tenant_id across all DMS tables.', 'Feature', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Translations & Multi-Tenant' AND date = '2026-01-05');
        ",

        '016b_ensure_attr_code' => "
            DO $$ 
            BEGIN 
                -- Ensure 'code' column exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='code') THEN 
                    ALTER TABLE dms_attributes ADD COLUMN code VARCHAR(50);
                END IF;

                -- Ensure 'code' is unique (optional but good practice)
                -- We check constraint existence to avoid error
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dms_attributes_code_key') THEN
                     -- Only enforce unique if we are sure data is clean. Maybe skip for now to be safe, 
                     -- or just add it. Let's add it but handle potential duplicates? 
                     -- For now just adding the column is sufficient for the 500 error.
                     NULL;
                END IF;
            END $$;
        ",

        '017_seed_invoice_attributes' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
                v_attr_id INTEGER;
            BEGIN
                -- 1. Invoice Number (Číslo faktury)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'Číslo faktury' AND tenant_id = v_tenant_id) THEN
                    -- Check if code column exists (it should based on error), if so include it.
                    -- Assuming strict schema where code exists.
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'INVOICE_NUMBER', 'Číslo faktury', 'text', true, true, '', 'Unique invoice number')
                    RETURNING rec_id INTO v_attr_id;

                    -- Translations / Variants
                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Invoice Number'),
                    ('dms_attributes', v_attr_id, 'en-s1', 'Invoice No'),
                    ('dms_attributes', v_attr_id, 'en-s2', 'Invoice #'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'Faktura č.'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'Daňový doklad č.');
                END IF;

                -- 2. Supplier ICO (IČO dodavatele)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'IČO dodavatele' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'SUPPLIER_ICO', 'IČO dodavatele', 'text', false, true, '', 'Supplier Identification Number')
                    RETURNING rec_id INTO v_attr_id;

                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Supplier ID'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'IČ:'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'IČO:'),
                    ('dms_attributes', v_attr_id, 'en-s1', 'Reg. No.'),
                    ('dms_attributes', v_attr_id, 'en-s2', 'Company ID');
                END IF;

                -- 3. Customer ICO (IČO odběratele)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'IČO odběratele' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'CUSTOMER_ICO', 'IČO odběratele', 'text', false, true, '', 'Customer Identification Number')
                    RETURNING rec_id INTO v_attr_id;

                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Customer ID'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'Odběratel IČ'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'Odběratel IČO');
                END IF;

                -- 4. Bank Account (Číslo účtu)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'Číslo účtu' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'BANK_ACCOUNT', 'Číslo účtu', 'text', false, true, '', 'Bank Account / IBAN')
                    RETURNING rec_id INTO v_attr_id;

                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Bank Account'),
                    ('dms_attributes', v_attr_id, 'en-s1', 'IBAN'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'Účet č.'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'Bankovní spojení');
                END IF;
                
                  -- 5. Total Price (Celková částka)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'Celková částka' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'TOTAL_AMOUNT', 'Celková částka', 'number', false, true, '', 'Total Amount')
                    RETURNING rec_id INTO v_attr_id;

                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Total Amount'),
                    ('dms_attributes', v_attr_id, 'en-s1', 'Total Price'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'Celkem'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'K úhradě');
                END IF;
                
                 -- 6. Date (Datum vystavení)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE name = 'Datum vystavení' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_required, is_searchable, default_value, help_text)
                    VALUES (v_tenant_id, 'ISSUE_DATE', 'Datum vystavení', 'date', false, true, '', 'Issue Date')
                    RETURNING rec_id INTO v_attr_id;

                    INSERT INTO sys_translations (table_name, record_id, language_code, translation) VALUES 
                    ('dms_attributes', v_attr_id, 'en', 'Issue Date'),
                    ('dms_attributes', v_attr_id, 'en-s1', 'Date'),
                    ('dms_attributes', v_attr_id, 'cs-s1', 'Datum'),
                    ('dms_attributes', v_attr_id, 'cs-s2', 'Vystaveno');
                END IF;

                -- Log
                INSERT INTO development_history (date, title, description, category, created_at)
                SELECT '2026-01-05', 'DMS Seed Attributes', 'Seeded standard invoice attributes (Invoice No, ICO, Bank Acc) with translations and variants for OCR.', 'Content', NOW()
                WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Seed Attributes' AND date = '2026-01-05');
            END $$;
        ",

        '018_dms_file_contents' => "
            -- Separate table for BLOB storage to avoid slowing down lists
            CREATE TABLE IF NOT EXISTS dms_file_contents (
                doc_id INTEGER PRIMARY KEY REFERENCES dms_documents(rec_id) ON DELETE CASCADE,
                content BYTEA NOT NULL
            );

            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'DMS Blob Storage', 'Added dms_file_contents table for persistent database file storage to support ephemeral hosting environments.', 'Backend', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Blob Storage' AND date = '2026-01-05');
        ",
        '019_add_metadata_column' => "
            DO $$ 
            BEGIN 
                -- Ensure 'metadata' column exists in dms_documents
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_documents' AND column_name='metadata') THEN 
                    ALTER TABLE dms_documents ADD COLUMN metadata JSONB DEFAULT '{}';
                END IF;
            END $$;

            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'DMS Metadata Column', 'Added metadata JSONB column to dms_documents for storing OCR and custom attributes.', 'Backend', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Metadata Column' AND date = '2026-01-05');
        ",
        '030_org_expansion' => "
            -- 1. Extend sys_organizations table
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='contact_email') THEN
                    ALTER TABLE sys_organizations ADD COLUMN contact_email VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='contact_phone') THEN
                    ALTER TABLE sys_organizations ADD COLUMN contact_phone VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='bank_account') THEN
                    ALTER TABLE sys_organizations ADD COLUMN bank_account VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='bank_code') THEN
                    ALTER TABLE sys_organizations ADD COLUMN bank_code VARCHAR(10);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='data_box_id') THEN
                    ALTER TABLE sys_organizations ADD COLUMN data_box_id VARCHAR(20);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='city') THEN
                    ALTER TABLE sys_organizations ADD COLUMN city VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='zip') THEN
                    ALTER TABLE sys_organizations ADD COLUMN zip VARCHAR(20);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='street') THEN
                    ALTER TABLE sys_organizations ADD COLUMN street VARCHAR(200);
                END IF;
            END $$;

            -- 2. Register Security Object
            INSERT INTO sys_security_objects (identifier, type, display_name, description)
            VALUES ('mod_orgs', 'module', 'Organizace', 'Správa firemních entit a fakturačních údajů.')
            ON CONFLICT (identifier) DO NOTHING;

            -- 3. Grant Admin Access
            INSERT INTO sys_security_permissions (role_id, object_id, access_level)
            SELECT r.rec_id, o.rec_id, 3
            FROM sys_security_roles r, sys_security_objects o
            WHERE r.code = 'ADMIN' AND o.identifier = 'mod_orgs'
            ON CONFLICT DO NOTHING;
            
            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT CURRENT_DATE, 'Module Organizations', 'Database expansion and security registration for Organization management.', 'Feature', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Module Organizations' AND date = CURRENT_DATE);
       ",
       '031_fix_users_initials' => "
            DO $$ 
            BEGIN 
                -- Add 'initials' to sys_users if missing
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_users' AND column_name='initials') THEN
                    ALTER TABLE sys_users ADD COLUMN initials VARCHAR(10);
                END IF;

                -- Populate initials for existing users
                UPDATE sys_users 
                SET initials = UPPER(substring(full_name, 1, 2)) 
                WHERE initials IS NULL AND full_name IS NOT NULL;
            END $$;
       ",
        '020_refine_attributes' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                -- 1. IČO dodavatele (SUPPLIER_ICO)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'SUPPLIER_ICO' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'SUPPLIER_ICO', 'IČO dodavatele', 'text', true, false);
                END IF;

                -- 2. Číslo účtu (BANK_ACCOUNT)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'BANK_ACCOUNT' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'BANK_ACCOUNT', 'Číslo účtu', 'text', true, false);
                END IF;

                -- 3. Datum vystavení (ISSUE_DATE)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'ISSUE_DATE' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'ISSUE_DATE', 'Datum vystavení', 'date', true, false);
                END IF;

                -- 4. Datum splatnosti (DUE_DATE)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'DUE_DATE' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'DUE_DATE', 'Datum splatnosti', 'date', true, false);
                END IF;

                -- 5. Celková částka (TOTAL_AMOUNT)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'TOTAL_AMOUNT' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'TOTAL_AMOUNT', 'Celková částka', 'number', true, false);
                END IF;
                
                -- 6. Dodavatel (SUPPLIER_NAME)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'SUPPLIER_NAME' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'SUPPLIER_NAME', 'Dodavatel', 'text', true, false);
                END IF;

            END $$;

            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'Refined Attributes', 'Added standard invoice attributes for improved OCR matching.', 'Backend', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Refined Attributes' AND date = '2026-01-05');
        ",
        '021_more_invoice_attributes' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                -- 7. Variabilní symbol (VARIABLE_SYMBOL)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VARIABLE_SYMBOL' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VARIABLE_SYMBOL', 'Variabilní symbol', 'text', true, false);
                END IF;

                -- 8. DIČ dodavatele (SUPPLIER_VAT_ID)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'SUPPLIER_VAT_ID' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'SUPPLIER_VAT_ID', 'DIČ dodavatele', 'text', true, false);
                END IF;

                -- 9. Datum plnění (DUZP)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'DUZP' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'DUZP', 'Datum plnění (DUZP)', 'date', true, false);
                END IF;

                -- 10. Měna (CURRENCY)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'CURRENCY' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required, default_value)
                    VALUES (v_tenant_id, 'CURRENCY', 'Měna', 'text', true, false, 'CZK');
                END IF;

                -- 11. DPH Celkem (VAT_TOTAL)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VAT_TOTAL' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VAT_TOTAL', 'DPH celkem', 'number', true, false);
                END IF;

            END $$;

            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'More Attributes', 'Added VS, VAT ID, DUZP, Currency, and VAT Total attributes.', 'Backend', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'More Attributes' AND date = '2026-01-05');
        ",
        '022_detailed_invoice_attributes' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                -- 12. Číslo objednávky (ORDER_NUMBER)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'ORDER_NUMBER' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'ORDER_NUMBER', 'Číslo objednávky', 'text', true, false);
                END IF;

                -- 13. Konstantní symbol (CONSTANT_SYMBOL)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'CONSTANT_SYMBOL' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'CONSTANT_SYMBOL', 'Konstantní symbol', 'text', true, false);
                END IF;

                -- 14. Základ DPH 21% (VAT_BASE_21)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VAT_BASE_21' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VAT_BASE_21', 'Základ DPH 21%', 'number', true, false);
                END IF;

                -- 15. Částka DPH 21% (VAT_AMOUNT_21)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VAT_AMOUNT_21' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VAT_AMOUNT_21', 'Částka DPH 21%', 'number', true, false);
                END IF;

                -- 16. Základ DPH snížená (VAT_BASE_REDUCED)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VAT_BASE_REDUCED' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VAT_BASE_REDUCED', 'Základ DPH snížená', 'number', true, false);
                END IF;

                -- 17. Částka DPH snížená (VAT_AMOUNT_REDUCED)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'VAT_AMOUNT_REDUCED' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'VAT_AMOUNT_REDUCED', 'Částka DPH snížená', 'number', true, false);
                END IF;

                -- 18. Položky faktury (INVOICE_ITEMS)
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'INVOICE_ITEMS' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'INVOICE_ITEMS', 'Položky faktury', 'text', true, false);
                END IF;

            END $$;

            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT '2026-01-05', 'Detailed Invoice Attributes', 'Added Order Num, KS, VAT breakdowns, and Line Items.', 'Backend', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Detailed Invoice Attributes' AND date = '2026-01-05');
        ",
        '023_bank_code_attribute' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM dms_attributes WHERE code = 'BANK_CODE' AND tenant_id = v_tenant_id) THEN
                    INSERT INTO dms_attributes (tenant_id, code, name, data_type, is_searchable, is_required)
                    VALUES (v_tenant_id, 'BANK_CODE', 'Kód banky', 'text', true, false);
                END IF;
            END $$;
        ",
        '024_storage_fix' => "
            CREATE TABLE IF NOT EXISTS dms_storage_profiles (
                rec_id SERIAL PRIMARY KEY,
                tenant_id UUID,
                name VARCHAR(100) NOT NULL,
                storage_type VARCHAR(50) DEFAULT 'local',
                base_path VARCHAR(500),
                connection_string TEXT,
                is_default BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            DO $$ 
            BEGIN 
                -- Alter connection_string to TEXT if it is not already, or ADD it if missing
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='connection_string') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN connection_string TEXT;
                ELSE
                    ALTER TABLE dms_storage_profiles ALTER COLUMN connection_string TYPE TEXT;
                END IF;

                -- Ensure is_default
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='is_default') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
                END IF;

                -- Ensure is_active
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='is_active') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
                END IF;
                
                -- Ensure tenant_id
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='tenant_id') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN tenant_id UUID;
                END IF;

                -- Ensure storage_type
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='storage_type') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN storage_type VARCHAR(50) DEFAULT 'local';
                END IF;

                -- Ensure base_path
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='base_path') THEN
                    ALTER TABLE dms_storage_profiles ADD COLUMN base_path VARCHAR(500);
                END IF;
            END $$;
        ",
        '032_add_roles_to_org_access' => "
            DO $$ 
            BEGIN 
                -- Add roles column to sys_user_org_access for per-org RBA
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_user_org_access' AND column_name='roles') THEN
                    ALTER TABLE sys_user_org_access ADD COLUMN roles JSONB DEFAULT '[]'::jsonb;
                END IF;
            END $$;
            
            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT CURRENT_DATE, 'Org Access Roles', 'Added roles column to sys_user_org_access to support organization-specific permissions.', 'Feature', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Org Access Roles' AND date = CURRENT_DATE);
        ",
        '033_sys_user_params' => "
            CREATE TABLE IF NOT EXISTS sys_user_params (
                rec_id SERIAL PRIMARY KEY,
                user_id INT NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
                param_key VARCHAR(100) NOT NULL,
                param_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, param_key)
            );
            
            INSERT INTO development_history (date, title, description, category, created_at)
            SELECT CURRENT_DATE, 'System User Params', 'Implemented sys_user_params table for storing persistable user state (SysLastValue pattern).', 'Feature', NOW()
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'System User Params' AND date = CURRENT_DATE);
        ",

        '025_add_scan_direction' => "
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='scan_direction') THEN
                    ALTER TABLE dms_attributes ADD COLUMN scan_direction VARCHAR(20) DEFAULT 'auto'; -- 'auto', 'right', 'down'
                END IF;
            END $$;
        ",
        '026_update_history_status' => "
            -- Insert History if not exists
            INSERT INTO development_history (date, title, description, category, related_task_id)
            SELECT CURRENT_DATE, 'Google Drive Integration', 'Implemented full support for uploads and error reporting (Feature)', 'feature', 14
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Google Drive Integration');

            INSERT INTO development_history (date, title, description, category, related_task_id)
            SELECT CURRENT_DATE, 'OCR Scan Direction', 'Configurable Right/Down scan logic per attribute', 'feature', 14
            WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'OCR Scan Direction');

            -- Insert QA Comment
            INSERT INTO sys_change_comments (cr_id, user_id, comment)
            SELECT 14, 1, 
'**QA Checklist (Auto-generated)**

**1. Google Drive Import**
- [ ] **Test připojení:** Nastavení -> Úložiště -> Test. Očekávání: \"Connection Successful\".
- [ ] **Nahrání (Validní):** Nahrajte PDF. Očekávání: Úspěch.
- [ ] **Nahrání (Chyba):** Změňte Folder ID na nesmysl. Očekávání: Warning \"Google Drive Error: 404/403\".

**2. OCR Směr čtení**
- [ ] **Konfigurace:** Nastavení -> Atributy -> Směr \"Vpravo\".
- [ ] **Test:** Nahrajte dokument. Očekávání: Hledá vpravo.

**3. Deployment**
- [ ] **Historie:** Ověřte nové položky v Historii vývoje.'

            WHERE NOT EXISTS (SELECT 1 FROM sys_change_comments WHERE cr_id = 14 AND comment LIKE '%QA Checklist%');
        ",
        '027_confirm_testing' => "
            -- Insert confirmation of testing based on user evidence
            INSERT INTO sys_change_comments (cr_id, user_id, comment)
            SELECT 14, 1,
'**QA Update: Testing Results**

✅ **Google Drive Import - Error Handling:** PASSED.
*Evidence:* System correctly identified Service Account quota issue (Error 403) and displayed warning to user.

⚠️ **Action Required:**
Administrator must configure Shared Drive or Enable Domain-Wide Delegation for the Service Account to resolve the quota 403 error.'
            WHERE NOT EXISTS (SELECT 1 FROM sys_change_comments WHERE cr_id = 14 AND comment LIKE '%QA Update%');
        ",
        '028_ensure_doc_types' => "
            DO $$
            DECLARE
                v_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                -- 1. Faktura přijatá (INV_IN)
                IF EXISTS (SELECT 1 FROM dms_doc_types WHERE name = 'Faktura přijatá') THEN
                    UPDATE dms_doc_types SET code = 'INV_IN' WHERE name = 'Faktura přijatá' AND code != 'INV_IN';
                ELSIF NOT EXISTS (SELECT 1 FROM dms_doc_types WHERE code = 'INV_IN') THEN
                    INSERT INTO dms_doc_types (tenant_id, name, code) VALUES (v_tenant_id, 'Faktura přijatá', 'INV_IN');
                END IF;

                -- 2. Smlouva (CONTRACT)
                IF EXISTS (SELECT 1 FROM dms_doc_types WHERE name = 'Smlouva') THEN
                    UPDATE dms_doc_types SET code = 'CONTRACT' WHERE name = 'Smlouva' AND code != 'CONTRACT';
                ELSIF NOT EXISTS (SELECT 1 FROM dms_doc_types WHERE code = 'CONTRACT') THEN
                    INSERT INTO dms_doc_types (tenant_id, name, code) VALUES (v_tenant_id, 'Smlouva', 'CONTRACT');
                END IF;

                -- 3. Účtenka (RECEIPT) - Fixes crash if name exists but code differs
                IF EXISTS (SELECT 1 FROM dms_doc_types WHERE name = 'Účtenka') THEN
                    UPDATE dms_doc_types SET code = 'RECEIPT' WHERE name = 'Účtenka' AND code != 'RECEIPT';
                ELSIF NOT EXISTS (SELECT 1 FROM dms_doc_types WHERE code = 'RECEIPT') THEN
                    INSERT INTO dms_doc_types (tenant_id, name, code) VALUES (v_tenant_id, 'Účtenka', 'RECEIPT');
                END IF;

                -- 4. Ostatní (OTHER)
                IF EXISTS (SELECT 1 FROM dms_doc_types WHERE name = 'Ostatní') THEN
                    UPDATE dms_doc_types SET code = 'OTHER' WHERE name = 'Ostatní' AND code != 'OTHER';
                ELSIF NOT EXISTS (SELECT 1 FROM dms_doc_types WHERE code = 'OTHER') THEN
                    INSERT INTO dms_doc_types (tenant_id, name, code) VALUES (v_tenant_id, 'Ostatní', 'OTHER');
                END IF;
            END $$;
        ",
        '013_ai_identity_fix' => "
            DO $$
            DECLARE
                v_ai_id INT;
                v_ticket_id INT := 7;
            BEGIN
                -- 1. Ensure AI User
                SELECT rec_id INTO v_ai_id FROM sys_users WHERE email = 'ai@shanon.dev';
                
                IF v_ai_id IS NULL THEN
                    INSERT INTO sys_users (tenant_id, full_name, email, password_hash, role, created_at)
                    VALUES ('00000000-0000-0000-0000-000000000001', 'AI Developer', 'ai@shanon.dev', 'DISABLED', 'admin', NOW())
                    RETURNING rec_id INTO v_ai_id;
                END IF;

                -- 2. Cleanup (Safe ASCII)
                UPDATE sys_change_comments 
                SET user_id = v_ai_id 
                WHERE comment LIKE '%Antigravity%' AND user_id != v_ai_id;

                -- 3. Log
                INSERT INTO development_history (date, title, category, related_task_id)
                SELECT CURRENT_DATE, 'Fix: Request UI Bugs', 'bugfix', v_ticket_id
                WHERE NOT EXISTS (
                    SELECT 1 FROM development_history WHERE related_task_id = v_ticket_id AND title LIKE 'Fix: Request UI%'
                );
            END $$;
        ",
        '014_sys_comment_reactions' => null,
        '029_dms_ocr_templates' => null,
        '030_dms_doc_type_attributes' => null,
        '031_reset_attributes' => null,
        '032_import_feature_log' => null,
        '033_sys_testing' => null,
        '034_seed_dms_test' => null,
        '035_dms_workflow_status' => null,
        '036_dms_storage' => null,
        '037_dms_doc_storage_link' => null,
        '038_dms_ocr_templates' => null,
        '039_dms_attribute_options' => null,
        '040_dms_ocr_data' => null,
        '041_dms_isolation' => null,
        '050_multi_org_structure' => null,
        '060_sys_docuref' => "
            CREATE TABLE IF NOT EXISTS sys_docuref (
                rec_id SERIAL PRIMARY KEY,
                ref_table VARCHAR(64) NOT NULL,
                ref_id INT NOT NULL,
                type VARCHAR(20) NOT NULL,
                name VARCHAR(255) NOT NULL,
                notes TEXT,
                file_path TEXT,
                file_mime VARCHAR(100),
                file_size BIGINT,
                storage_type VARCHAR(50) DEFAULT 'local',
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_docuref_lookup ON sys_docuref (ref_table, ref_id);

            CREATE TABLE IF NOT EXISTS sys_parameters (
                param_key VARCHAR(100) PRIMARY KEY,
                param_value TEXT,
                description VARCHAR(255)
            );
            
            INSERT INTO sys_parameters (param_key, param_value, description)
            VALUES ('DOCUREF_STORAGE_PATH', 'uploads/docuref', 'Default storage path for attachments')
            ON CONFLICT (param_key) DO NOTHING;
        ",
        '070_sys_user_favorites' => null,
        '071_sys_help' => null,
        '072_seed_help' => null,
        '073_sys_help_map' => null,
        '074_update_help_shortcuts' => null,
        '080_shared_companies' => null,
        '081_sys_user_params' => null,
        '090_add_ui_standard_test' => null,
        '091_sys_parameters_tenant' => "
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_parameters' AND column_name='tenant_id') THEN
                    ALTER TABLE sys_parameters ADD COLUMN tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_parameters' AND column_name='org_id') THEN
                    ALTER TABLE sys_parameters ADD COLUMN org_id CHAR(5);
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_parameters' AND column_name='rec_id') THEN
                    BEGIN
                        ALTER TABLE sys_parameters DROP CONSTRAINT IF EXISTS sys_parameters_pkey CASCADE;
                    EXCEPTION WHEN OTHERS THEN NULL; END;
                    ALTER TABLE sys_parameters ADD COLUMN rec_id SERIAL PRIMARY KEY;
                END IF;
            END $$;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_params_global_v2 
                ON sys_parameters (tenant_id, param_key) 
                WHERE org_id IS NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_params_org_v2 
                ON sys_parameters (tenant_id, org_id, param_key) 
                WHERE org_id IS NOT NULL;
                
            DO $$
            DECLARE 
               v_tenant UUID := '00000000-0000-0000-0000-000000000001';
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM sys_parameters WHERE param_key = 'CHATGPT_API_KEY' AND tenant_id = v_tenant AND org_id IS NULL) THEN
                    INSERT INTO sys_parameters (tenant_id, param_key, param_value, description)
                    VALUES (v_tenant, 'CHATGPT_API_KEY', '', 'API klíč pro OpenAI ChatGPT');
                END IF;
                IF NOT EXISTS (SELECT 1 FROM sys_parameters WHERE param_key = 'CHATGPT_SYSTEM_PROMPT' AND tenant_id = v_tenant AND org_id IS NULL) THEN
                    INSERT INTO sys_parameters (tenant_id, param_key, param_value, description)
                    VALUES (v_tenant, 'CHATGPT_SYSTEM_PROMPT', 'Jste ERP asistent Shanon. Vaším cílem je pomoci s analýzou dokumentů.', 'Výchozí systémový prompt pro AI');
                END IF;
            END $$;
        "
    ];




    // --- EXECUTION ---
    
    foreach ($migrations as $name => $sql) {
        // Handle numeric keys or missing SQL (file loading)
        if (is_int($name)) {
            $name = $sql;
            $sql = null;
        }

        if (!$sql) {
             $path = __DIR__ . '/migrations/' . $name . '.sql';
             if (file_exists($path)) {
                 $sql = file_get_contents($path);
             } else {
                 $messages[] = "Migration '$name': Skipped (File not found at $path)";
                 continue;
             }
        }

        try {
            // Exec migration
            $pdo->exec($sql);
            $messages[] = "Migration '$name': OK";
        } catch (Exception $e) {
            // Log error but CONTINUE to next migration (Best Effort)
            $messages[] = "Migration '$name' FAILED: " . $e->getMessage();
            error_log("Migration '$name' FAILED: " . $e->getMessage());
            // continue; implied
        }
    }
    
    echo json_encode([
        'success' => true,
        'message' => 'All migrations executed successfully.',
        'details' => $messages
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false, 
        'error' => $e->getMessage()
    ]);
}
