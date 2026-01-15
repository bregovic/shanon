<?php
// backend/fix_storage_db.php
require_once 'db.php';

try {
    $pdo = DB::connect();
    
    // 1. Create Table
    $sql = "CREATE TABLE IF NOT EXISTS dms_storage_profiles (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        configuration JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )";
    $pdo->exec($sql);
    echo "Table dms_storage_profiles created/checked.<br>";

    // 2. Seed 'Local'
    $stmt = $pdo->query("SELECT COUNT(*) FROM dms_storage_profiles WHERE type = 'local'");
    if ($stmt->fetchColumn() == 0) {
        $pdo->exec("INSERT INTO dms_storage_profiles (name, type, is_active, is_default) VALUES ('Lokální úložiště', 'local', true, true)");
        echo "Seeded Local profile.<br>";
    }

    // 3. Seed 'Google Drive'
    $stmt = $pdo->query("SELECT COUNT(*) FROM dms_storage_profiles WHERE type = 'google_drive'");
    if ($stmt->fetchColumn() == 0) {
        $pdo->exec("INSERT INTO dms_storage_profiles (name, type, is_active, is_default) VALUES ('Google Drive', 'google_drive', true, false)");
        echo "Seeded Google Drive profile.<br>";
    }

    echo "Done.";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
