<?php
// backend/fix_db_users.php
// ONE-TIME FIX: Add missing columns to sys_users

require_once 'db.php';
require_once 'cors.php'; // Allow executing from browser/client

header('Content-Type: text/plain');

try {
    $pdo = DB::connect();
    echo "Connected to DB.\n";
    
    // 1. updated_at
    echo "Checking 'updated_at'...\n";
    $pdo->exec("ALTER TABLE sys_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    echo "OK.\n";
    
    // 2. settings
    echo "Checking 'settings'...\n";
    $pdo->exec("ALTER TABLE sys_users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb");
    echo "OK.\n";
    
    echo "Migration completed successfully.";
    
} catch (Exception $e) {
    http_response_code(500);
    echo "ERROR: " . $e->getMessage();
}
