<?php
// backend/install-db.php
// Unified Database Migration Script
// Usage: /api/install-db.php?token=shanon2026install

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once 'db.php';

// Security Check
$token = $_GET['token'] ?? '';
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
