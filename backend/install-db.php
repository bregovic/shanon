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
        // FIX: Ensure columns exist (Schema Evolution)
        '002a_dms_schema_ensure_columns' => "
            DO $$ 
            BEGIN 
                -- Ensure 'code' exists (Legacy column)
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='code') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN code VARCHAR(50);
                    -- If we had type_code, maybe copy it? unlikely to have data yet
                END IF;

                -- Ensure 'icon' exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_doc_types' AND column_name='icon') THEN 
                    ALTER TABLE dms_doc_types ADD COLUMN icon VARCHAR(50);
                END IF;

                -- If 'type_code' exists (from previous partial run), we can leave it or ignore it. 
                -- We will strictly use 'code' from now on.
            END $$;
        ",
        // Setup Constraints if missing (Separate step to avoid transaction issues inside DO block if simpler)
        '002b_dms_constraints' => "
             DO $$ 
             BEGIN
                -- Ensure code is unique if constraint missing
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dms_doc_types_code_key') THEN
                    ALTER TABLE dms_doc_types ADD CONSTRAINT dms_doc_types_code_key UNIQUE (code);
                END IF;
             END $$;
        ",
        '003_dms_setup_data' => "
            -- Initial Data for DMS using 'code'
            INSERT INTO dms_doc_types (code, name, icon) VALUES 
            ('INV_IN', 'Faktura přijatá', 'Document24Regular'),
            ('INV_OUT', 'Faktura vydaná', 'Document24Regular'),
            ('CONTRACT', 'Smlouva', 'Document24Regular'),
            ('OTHER', 'Ostatní', 'Document24Regular')
            ON CONFLICT (code) DO UPDATE SET 
                name = EXCLUDED.name,
                icon = EXCLUDED.icon;
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
