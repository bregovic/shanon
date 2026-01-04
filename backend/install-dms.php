<?php
// backend/install-dms.php
// Run DMS migrations

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// Simple auth check
if (!isset($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized - please login first']);
    exit;
}

try {
    $pdo = DB::connect();
    
    $migrations = [
        '002_dms_core.sql',
        '003_dms_setup.sql'
    ];
    
    $results = [];
    
    foreach ($migrations as $file) {
        $path = __DIR__ . '/migrations/' . $file;
        if (!file_exists($path)) {
            $results[$file] = 'File not found';
            continue;
        }
        
        $sql = file_get_contents($path);
        
        try {
            $pdo->exec($sql);
            $results[$file] = 'OK';
        } catch (PDOException $e) {
            // Ignore "already exists" errors
            if (strpos($e->getMessage(), 'already exists') !== false) {
                $results[$file] = 'Already exists (OK)';
            } else {
                $results[$file] = 'Error: ' . $e->getMessage();
            }
        }
    }
    
    echo json_encode([
        'success' => true,
        'message' => 'DMS migrations completed',
        'results' => $results
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
