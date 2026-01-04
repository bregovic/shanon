<?php
// backend/install-sessions.php
// Script to create session table in database

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once 'db.php';

// Auth check (simple token like DMS)
$token = $_GET['token'] ?? '';
if ($token !== 'shanon2026install') {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

try {
    $pdo = DB::connect();
    
    // Create sessions table
    $sql = "
    CREATE TABLE IF NOT EXISTS sys_sessions (
        id VARCHAR(128) PRIMARY KEY,
        data TEXT NOT NULL,
        access INT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_access ON sys_sessions (access);
    ";
    
    $pdo->exec($sql);
    
    echo json_encode([
        'success' => true, 
        'message' => 'Table sys_sessions created successfully.'
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false, 
        'error' => $e->getMessage()
    ]);
}
