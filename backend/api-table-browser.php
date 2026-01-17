<?php
// backend/api-table-browser.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

// SECURITY: Only ADMIN can access table browser
// strict check
if (!isset($_SESSION['user']) || ($_SESSION['user']['role'] ?? '') !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access Denied: Admins only']);
    exit;
}

$action = $_GET['action'] ?? 'list_tables';
$input = json_decode(file_get_contents('php://input'), true);

try {
    $pdo = DB::connect();

    if ($action === 'list_tables') {
        // List all tables in public schema
        // Also try to get estimated row count from pg_stats
        $sql = "
            SELECT 
                t.table_name,
                pg_size_pretty(pg_total_relation_size('\"' || t.table_name || '\"')) as size,
                (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = t.table_name) as estimated_rows
            FROM information_schema.tables t
            WHERE t.table_schema = 'public'
            ORDER BY t.table_name
        ";
        $stmt = $pdo->query($sql);
        $tables = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Add ID for grid
        foreach ($tables as &$t) {
            $t['id'] = $t['table_name'];
        }

        echo json_encode(['success' => true, 'data' => $tables]);

    } elseif ($action === 'get_data') {
        $table = $_GET['table'] ?? '';
        
        // Sanitize table name strictly to avoid SQL injection
        // Only allow alphanumeric and underscore
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            throw new Exception("Invalid table name");
        }

        // Check if table exists
        $check = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = ?");
        $check->execute([$table]);
        if (!$check->fetch()) {
            throw new Exception("Table not found");
        }

        // Get Columns Metadata first
        $colSql = "
            SELECT column_name, data_type, ordinal_position
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = ?
            ORDER BY ordinal_position
        ";
        $stmtCol = $pdo->prepare($colSql);
        $stmtCol->execute([$table]);
        $columns = $stmtCol->fetchAll(PDO::FETCH_ASSOC);

        // Hard limit for browser performance
        $limit = 500; 
        
        // Fetch Data
        // Use quote identifier for table name
        $dataSql = "SELECT * FROM \"$table\" LIMIT $limit";
        $stmtData = $pdo->query($dataSql);
        $rows = $stmtData->fetchAll(PDO::FETCH_ASSOC);

        // Standardize rows for Grid (ensure all columns exist even if null)
        // actually fetchAll assoc does this well.

        echo json_encode([
            'success' => true, 
            'columns' => $columns,
            'data' => $rows,
            'meta' => [
                'limit' => $limit,
                'total_shown' => count($rows)
            ]
        ]);
    } else {
        throw new Exception("Invalid action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
