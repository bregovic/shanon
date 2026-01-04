<?php
// backend/test-health.php
// Simple Health Check - NO SESSIONS

header('Content-Type: application/json');
require_once 'cors.php';
require_once 'db.php';

$start = microtime(true);

try {
    // 1. Test PHP
    $phpStatus = "OK " . phpversion();

    // 2. Test DB Connection
    $pdo = DB::connect();
    
    // 3. Simple Query
    $stmt = $pdo->query("SELECT NOW() as db_time");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    
    // 4. Check Session Table
    $stmt2 = $pdo->query("SELECT COUNT(*) as cnt FROM sys_sessions");
    $sessionCount = $stmt2->fetchColumn();

    $end = microtime(true);

    echo json_encode([
        'status' => 'healthy',
        'php' => $phpStatus,
        'db_time' => $row['db_time'],
        'active_sessions_in_db' => $sessionCount,
        'duration_ms' => round(($end - $start) * 1000, 2)
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ]);
}
