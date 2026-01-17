<?php
// backend/api-system-maintenance.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

// SECURITY: Only ADMIN
if (!isset($_SESSION['user']) || ($_SESSION['user']['role'] ?? '') !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access Denied: Admins only']);
    exit;
}

$action = $_GET['action'] ?? '';

try {
    // Increase timeout for maintenance tasks
    set_time_limit(300); // 5 minutes max
    
    $pdo = DB::connect();

    if ($action === 'reindex') {
        // 1. Get List of Tables
        $stmt = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $results = [];
        $errors = [];

        // 2. Perform Analyze (safe, updates stats)
        foreach ($tables as $table) {
            try {
                // ANALYZE is non-blocking usually
                $pdo->exec("ANALYZE \"$table\"");
                $results[] = "Analyzed $table";
            } catch (Exception $e) {
                $errors[] = "Failed to analyze $table: " . $e->getMessage();
            }
        }

        // 3. Reindex specific heavy tables or all (careful with locking)
        // For now, we will just analyze + VACUUM (maintenance)
        // REINDEX is heavy. Let's do VACUUM ANALYZE.
        
        // Let's TRY REINDEX on system tables that are critical for search
        $criticalTables = ['sys_help_pages', 'sys_users', 'sys_audit_log', 'sys_dms_documents'];
        foreach ($criticalTables as $ct) {
            if (in_array($ct, $tables)) {
                 try {
                    $pdo->exec("REINDEX TABLE \"$ct\"");
                    $results[] = "Reindexed $ct";
                } catch (Exception $e) {
                    $errors[] = "Failed to reindex $ct: " . $e->getMessage();
                }
            }
        }

        echo json_encode([
            'success' => true, 
            'message' => 'Maintenance completed',
            'details' => $results,
            'errors' => $errors
        ]);

    } else {
        throw new Exception("Invalid action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
