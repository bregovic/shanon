<?php
// api-system-params.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// Auth check
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$tenantId = $_SESSION['tenant_id'] ?? '00000000-0000-0000-0000-000000000001';
$orgId = $_SESSION['current_org_id'] ?? null;
$action = $_GET['action'] ?? 'list';

try {
    $db = DB::connect();

    if ($action === 'list') {
        $sql = "SELECT rec_id, param_key, param_value, description, org_id 
                FROM sys_parameters 
                WHERE tenant_id = :tid 
                  AND (org_id IS NULL OR org_id = :oid)
                ORDER BY param_key, org_id NULLS FIRST";
                
        $stmt = $db->prepare($sql);
        $stmt->execute(['tid' => $tenantId, 'oid' => $orgId]);
        $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Merge so specific overrides shared
        $merged = [];
        foreach ($raw as $row) {
            $merged[$row['param_key']] = $row; 
        }
        
        echo json_encode(['success' => true, 'data' => array_values($merged)]);
    } 
    elseif ($action === 'update') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) throw new Exception("Invalid JSON");
        
        $key = $input['key'] ?? '';
        $value = $input['value'] ?? '';
        $scope = $input['scope'] ?? 'local'; // 'global' for shared across tenant, 'local' for private to org
        
        if (empty($key)) throw new Exception("Missing key");
        
        $targetOrgId = ($scope === 'global') ? null : $orgId;
        
        if ($targetOrgId === null) {
            $stmt = $db->prepare("
                INSERT INTO sys_parameters (tenant_id, org_id, param_key, param_value) 
                VALUES (?, NULL, ?, ?)
                ON CONFLICT (tenant_id, param_key) WHERE org_id IS NULL 
                DO UPDATE SET param_value = EXCLUDED.param_value
            ");
            $stmt->execute([$tenantId, $key, $value]);
        } else {
            $stmt = $db->prepare("
                INSERT INTO sys_parameters (tenant_id, org_id, param_key, param_value) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT (tenant_id, org_id, param_key) WHERE org_id IS NOT NULL 
                DO UPDATE SET param_value = EXCLUDED.param_value
            ");
            $stmt->execute([$tenantId, $targetOrgId, $key, $value]);
        }
        
        echo json_encode(['success' => true]);
    }
    else {
        throw new Exception("Unknown action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
