<?php
// backend/api-user.php
// User Specific Actions (Preferences, Profile)

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

// Unlock session for perf
session_write_close(); 

header("Content-Type: application/json");

// Auth Check
if (!isset($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = $_SESSION['user']['rec_id'] ?? null;
$tenantId = $_SESSION['user']['tenant_id'] ?? '00000000-0000-0000-0000-000000000001';
$currentOrgId = $_SESSION['current_org_id'] ?? null;

$action = $_GET['action'] ?? 'list';

try {
    $pdo = DB::connect();

    // -------------------------------------------------------------------------
    // ACTION: SAVE PARAM (Grid Prefs, etc.)
    // -------------------------------------------------------------------------
    if ($action === 'save_param') {
        $input = json_decode(file_get_contents('php://input'), true);
        $key = $input['key'] ?? null;
        $value = $input['value'] ?? null;
        $isOrgSpecific = $input['org_specific'] ?? false;

        if (!$key) throw new Exception("Key required");

        $storeOrgId = $isOrgSpecific ? $currentOrgId : null;
        
        // Transactional Upsert (Delete + Insert to handle JSON updates cleanly)
        DB::transaction(function($pdo) use ($userId, $tenantId, $storeOrgId, $key, $value) {
            // Delete existing
            if ($storeOrgId === null) {
                $stmt = $pdo->prepare("DELETE FROM sys_user_params WHERE user_id = :uid AND param_key = :key AND org_id IS NULL");
                $stmt->execute([':uid'=>$userId, ':key'=>$key]);
            } else {
                 $stmt = $pdo->prepare("DELETE FROM sys_user_params WHERE user_id = :uid AND param_key = :key AND org_id = :oid");
                 $stmt->execute([':uid'=>$userId, ':key'=>$key, ':oid'=>$storeOrgId]);
            }

            // Insert new
            $sql = "INSERT INTO sys_user_params (tenant_id, user_id, org_id, param_key, param_value, updated_at) 
                    VALUES (:tid, :uid, :oid, :key, :val, NOW())";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':tid' => $tenantId,
                ':uid' => $userId,
                ':oid' => $storeOrgId,
                ':key' => $key,
                ':val' => json_encode($value)
            ]);
        });

        echo json_encode(['success' => true]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: GET PARAM
    // -------------------------------------------------------------------------
    if ($action === 'get_param') {
        $key = $_GET['key'] ?? null;
        $isOrgSpecific = filter_var($_GET['org_specific'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if (!$key) throw new Exception("Key required");

        $sql = "SELECT param_value FROM sys_user_params WHERE user_id = :uid AND param_key = :key";
        $params = [':uid'=>$userId, ':key'=>$key];

        if ($isOrgSpecific) {
            $sql .= " AND org_id = :oid";
            $params[':oid'] = $currentOrgId;
        } else {
            $sql .= " AND org_id IS NULL";
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $val = $row ? json_decode($row['param_value'], true) : null;
        
        echo json_encode(['success' => true, 'data' => $val]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: LIST PARAMS (For cleanup UI)
    // -------------------------------------------------------------------------
    if ($action === 'list_params') {
         $stmt = $pdo->prepare("SELECT rec_id, org_id, param_key, updated_at FROM sys_user_params WHERE user_id = :uid ORDER BY updated_at DESC");
         $stmt->execute([':uid' => $userId]);
         $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
         echo json_encode(['success'=>true, 'data'=>$rows]);
         exit;
    }

    if ($action === 'delete_param') {
         $input = json_decode(file_get_contents('php://input'), true) ?? $_GET; // Support GET or POST
         $id = $input['id'] ?? null;

         if (!$id) throw new Exception("ID required");
         
         $stmt = $pdo->prepare("DELETE FROM sys_user_params WHERE rec_id = :id AND user_id = :uid");
         $stmt->execute([':id'=>$id, ':uid'=>$userId]);
         
         echo json_encode(['success' => true]);
         exit;
    }

} catch (Exception $e) {
    http_response_code(500);
    $msg = $e->getMessage();
    file_put_contents('debug.txt', date('Y-m-d H:i:s') . " Error: $msg\n", FILE_APPEND);
    echo json_encode(['success'=>false, 'error'=>$msg]);
}
