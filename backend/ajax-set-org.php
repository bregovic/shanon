<?php
// backend/ajax-set-org.php
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

if (empty($orgId)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing OrgId']);
    exit;
}

require_once 'db.php';

try {
    $pdo = DB::connect();
    $userId = $_SESSION['user']['rec_id'];

    // Verify access
    $stmt = $pdo->prepare("SELECT 1 FROM sys_user_org_access WHERE user_id = :uid AND org_id = :oid");
    $stmt->execute([':uid' => $userId, ':oid' => $orgId]);

    if ($stmt->fetch()) {
        $_SESSION['current_org_id'] = $orgId;
        echo json_encode([
            'success' => true, 
            'message' => 'Context switched',
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
