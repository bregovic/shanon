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
    // Add new migrations here. Order matters.
    
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
            -- DMS Core Tables
            CREATE TABLE IF NOT EXISTS dms_doc_types (
                rec_id SERIAL PRIMARY KEY,
                type_code VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
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
        '003_dms_setup_data' => "
            -- Initial Data for DMS
            INSERT INTO dms_doc_types (type_code, name) VALUES 
            ('INV_IN', 'Faktura přijatá'),
            ('INV_OUT', 'Faktura vydaná'),
            ('CONTRACT', 'Smlouva'),
            ('OTHER', 'Ostatní')
            ON CONFLICT (type_code) DO NOTHING;
        "
    ];

    // --- EXECUTION ---
    
    foreach ($migrations as $name => $sql) {
        try {
            $pdo->exec($sql);
            $messages[] = "Migration '$name': OK";
        } catch (Exception $e) {
            // Log error but maybe continue? Or stop? 
            // For now we stop on error to prevent inconsistent state
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
