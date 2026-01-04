<?php
// backend/install-dms.php
// Run DMS migrations with secret token auth

require_once 'cors.php';
require_once 'db.php';

header("Content-Type: application/json");

// Use secret token instead of session (for direct URL access)
$token = $_GET['token'] ?? '';
$expectedToken = 'shanon2026install';

if ($token !== $expectedToken) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid token. Use: ?token=shanon2026install']);
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
    ], JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
