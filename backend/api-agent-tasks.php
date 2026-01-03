<?php
// backend/api-agent-tasks.php
// Tento endpoint slouží AI Agentovi ke čtení schválených úkolů z SQL.

require_once 'db.php';
require_once 'cors.php'; // Allow access

// Security: In production, require an API Key!
// For now, we rely on Dev Environment isolation.

try {
    $pdo = DB::connect();
    
    // Hledáme požadavky ve stavu 'Approved' nebo 'Development'
    // Které ještě nejsou 'Done'
    $sql = "SELECT rec_id, subject, description, priority, created_by 
            FROM sys_change_requests 
            WHERE status IN ('Approved', 'Back to development') 
            ORDER BY priority DESC, created_at ASC
            LIMIT 1";

    $stmt = $pdo->query($sql);
    $task = $stmt->fetch();

    if ($task) {
        echo json_encode([
            'has_work' => true,
            'task' => $task
        ]);
    } else {
        echo json_encode([
            'has_work' => false,
            'message' => 'No approved tasks found in SQL.'
        ]);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
