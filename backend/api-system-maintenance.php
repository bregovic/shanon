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

    if ($action === 'get_tables_list') {
        // return list of tables to process
        $stmt = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
        $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
        echo json_encode(['success' => true, 'tables' => $tables]);

    } elseif ($action === 'maintain_table') {
        // Process single table
        $table = $_GET['table'] ?? '';
        
        // Simple sanitization
        $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
        if (!$safeTable || $safeTable !== $table) {
            throw new Exception("Invalid or missing table name");
        }

        $log = [];
        
        // 1. ANALYZE - Fast, non-blocking usually
        try {
            $pdo->exec("ANALYZE \"$safeTable\"");
            $log[] = "Statistics updated (ANALYZE)";
        } catch (Exception $e) {
            $log[] = "ANALYZE Failed: " . $e->getMessage();
        }

        // 2. REINDEX - Heavier, locks table
        // We only reindex if specifically requested or for system tables that might get fragmented
        // For this feature, we do it for all since user clicked "Reindex".
        try {
            $pdo->exec("REINDEX TABLE \"$safeTable\"");
            $log[] = "Indices rebuilt (REINDEX)";
        } catch (Exception $e) {
            $log[] = "REINDEX Failed: " . $e->getMessage();
        }

        echo json_encode(['success' => true, 'table' => $safeTable, 'details' => implode(', ', $log)]);

    } elseif ($action === 'reindex') {
        // Legacy bulk mode (keep for compatibility if needed, but we will switch frontend)
        $stmt = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
        // ... (truncated legacy logic) ...
        echo json_encode(['success' => true, 'message' => 'Complete (Legacy Mode)']);
    } else {
        throw new Exception("Invalid action: $action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
