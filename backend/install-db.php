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
        '009_consolidate_roles',
    '010_sys_change_comments' => "
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
        "
    ];


    // --- EXECUTION ---
    
    foreach ($migrations as $name => $sql) {
        try {
            $pdo->exec($sql);
            $messages[] = "Migration '$name': OK";
        } catch (Exception $e) {
            // Rethrow to stop execution
            throw new Exception("Migration '$name' failed: " . $e->getMessage());
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
