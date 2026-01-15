<?php
// backend/ajax-set-org.php
// Switch Organization Context and optionally set as default
require_once 'cors.php';
require_once 'session_init.php';

header("Content-Type: application/json");

if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$orgId = $input['org_id'] ?? '';
$setDefault = $input['set_default'] ?? false;

if (empty($orgId)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing OrgId']);
    exit;
}

require_once 'db.php';

try {
    $pdo = DB::connect();
    $userId = $_SESSION['user']['rec_id'];
    $userRoles = $_SESSION['user']['roles'] ?? [];
    
    // Admin Bypass: ADMIN role can switch to ANY active organization
    $isAdmin = in_array('admin', array_map('strtolower', (array)$userRoles));
    
    $hasAccess = false;
    
    if ($isAdmin) {
        // Check if org exists and is active
        $stmt = $pdo->prepare("SELECT 1 FROM sys_organizations WHERE org_id = :oid AND is_active = true");
        $stmt->execute([':oid' => $orgId]);
        $hasAccess = (bool)$stmt->fetch();
    } else {
        // Standard user: check access table
        $stmt = $pdo->prepare("SELECT 1 FROM sys_user_org_access WHERE user_id = :uid AND org_id = :oid");
        $stmt->execute([':uid' => $userId, ':oid' => $orgId]);
        $hasAccess = (bool)$stmt->fetch();
    }

    if ($hasAccess) {
        $_SESSION['current_org_id'] = $orgId;
        
        // Optionally set as default for user
        if ($setDefault) {
            // Clear previous defaults
            $pdo->prepare("UPDATE sys_user_org_access SET is_default = false WHERE user_id = :uid")
                ->execute([':uid' => $userId]);
            
            // Upsert new default (Admin might not have explicit access row)
            $stmt = $pdo->prepare("
                INSERT INTO sys_user_org_access (user_id, org_id, is_default) 
                VALUES (:uid, :oid, true)
                ON CONFLICT (user_id, org_id) DO UPDATE SET is_default = true
            ");
            $stmt->execute([':uid' => $userId, ':oid' => $orgId]);
        }
        
        echo json_encode([
            'success' => true, 
            'message' => $setDefault ? 'Default organization updated' : 'Context switched',
            'current_org_id' => $orgId
        ]);
    } else {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Access Denied to this Organization']);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
