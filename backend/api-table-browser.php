<?php
// backend/api-table-browser.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

// SECURITY: ONLY ADMIN or SUPERADMIN
if (!isset($_SESSION['user'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access Denied: Not logged in']);
    exit;
}

$role = $_SESSION['user']['role'] ?? '';
// Allow admin, superadmin, or sysadmin
if ($role !== 'admin' && $role !== 'superadmin' && $role !== 'sysadmin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => "Access Denied: Role '$role' not authorized"]);
    exit;
}

$action = $_GET['action'] ?? 'list_tables';
$input = json_decode(file_get_contents('php://input'), true);

try {
    $pdo = DB::connect();

    // -- HELPER: Check columns exists --
    function getTableColumns($pdo, $table) {
        $stmt = $pdo->prepare("
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = ?
        ");
        $stmt->execute([$table]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    if ($action === 'list_tables') {
        // List tables with size info and description (COMMENT)
        $sql = "
            SELECT 
                t.table_name,
                pg_size_pretty(pg_total_relation_size('\"' || t.table_name || '\"')) as size,
                (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = t.table_name) as estimated_rows,
                obj_description(c.oid) as description
            FROM information_schema.tables t
            LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relkind = 'r'
            WHERE t.table_schema = 'public'
            ORDER BY t.table_name
        ";
        $stmt = $pdo->query($sql);
        $tables = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Add 'id' for frontend grid
        foreach ($tables as &$t) $t['id'] = $t['table_name'];

        echo json_encode(['success' => true, 'data' => $tables]);

    } elseif ($action === 'get_data') {
        $table = $_GET['table'] ?? '';
        $tenantId = $_SESSION['user']['tenant_id'] ?? null;
        
         // Security: Whitelist chars
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) throw new Exception("Invalid table name");

        // 1. Get Columns
        $columns = getTableColumns($pdo, $table);
        if (empty($columns)) throw new Exception("Table not found");

        $hasTenantId = false;
        foreach ($columns as $c) {
            if ($c['column_name'] === 'tenant_id') $hasTenantId = true;
        }

        // 2. Build Query
        $sql = "SELECT * FROM \"$table\"";
        $params = [];
        
        // Tenant Filtering
        if ($hasTenantId && $tenantId) {
            $sql .= " WHERE tenant_id = ?";
            $params[] = $tenantId;
        }

        $sql .= " LIMIT 500";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // 3. Analyze Features (Status)
        $features = [
            'has_tenant' => $hasTenantId,
            'has_timestamps' => false,
            'has_audit' => false // Placeholder for trigger check
        ];
        // Check for created_at/updated_at
        $colNames = array_column($columns, 'column_name');
        if (in_array('created_at', $colNames) && in_array('updated_at', $colNames)) {
            $features['has_timestamps'] = true;
        }

        // 4. Get table description (COMMENT)
        $descStmt = $pdo->prepare("SELECT obj_description(c.oid) as description FROM pg_class c WHERE c.relname = ? AND c.relkind = 'r'");
        $descStmt->execute([$table]);
        $descRow = $descStmt->fetch(PDO::FETCH_ASSOC);
        $description = $descRow['description'] ?? '';

        echo json_encode([
            'success' => true,
            'columns' => $columns,
            'data' => $rows,
            'features' => $features,
            'description' => $description,
            'filter_active' => ($hasTenantId && $tenantId) ? "Filtered by Tenant: $tenantId" : "Show All (System/Public)"
        ]);

    } elseif ($action === 'execute_sql') {
        $sql = $input['sql'] ?? '';
        if (!$sql) throw new Exception("Empty SQL");

        // Execute raw SQL
        // We use query() specifically. If select, fetch. If update/delete, count.
        
        // Detect query type (simple check)
        $isSelect = stripos(trim($sql), 'SELECT') === 0 || stripos(trim($sql), 'WITH') === 0;

        try {
            if ($isSelect) {
                $stmt = $pdo->query($sql);
                $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
                $count = count($rows);
                
                // Get dynamic columns from result/ first row
                $columns = [];
                if ($count > 0) {
                    $keys = array_keys($rows[0]);
                    foreach($keys as $k) $columns[] = ['column_name' => $k, 'data_type' => 'unknown'];
                }

                echo json_encode([
                    'success' => true,
                    'type' => 'SELECT',
                    'count' => $count,
                    'data' => $rows,
                    'columns' => $columns
                ]);
            } else {
                // UPDATE/INSERT/DDL
                $affected = $pdo->exec($sql);
                echo json_encode([
                    'success' => true,
                    'type' => 'COMMAND', 
                    'message' => "Executed successfully. Affected rows: " . ($affected === false ? 'Unknown' : $affected)
                ]);
            }
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }

    } elseif ($action === 'apply_feature') {
        // Apply standard columns or triggers
        $table = $input['table'] ?? '';
        $feature = $input['feature'] ?? '';
        
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) throw new Exception("Invalid table name");

        $sql = "";
        if ($feature === 'timestamps') {
            $sql = "
                ALTER TABLE \"$table\" 
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN IF NOT EXISTS created_by INT,
                ADD COLUMN IF NOT EXISTS updated_by INT;
            ";
        } elseif ($feature === 'soft_delete') {
            $sql = "ALTER TABLE \"$table\" ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;";
        } else {
            throw new Exception("Unknown feature");
        }

        if ($sql) {
            $pdo->exec($sql);
            echo json_encode(['success' => true, 'message' => "Feature $feature applied"]);
        }

    } else {
        throw new Exception("Invalid action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
