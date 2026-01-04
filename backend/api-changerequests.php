<?php
// backend/api-changerequests.php
// Shanon Enterprise Change Management API

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// --- CONFIG ---
const TABLE_ID_CR = 100; // SysTableId for ChangeRequests

// --- AUTH ---
if (!isset($_SESSION['loggedin']) || !isset($_SESSION['user'])) {
    // Basic fallback for dev (should be stricter in prod)
    $userId = 1; 
    $tenantId = '00000000-0000-0000-0000-000000000001';
} else {
    $userId = $_SESSION['user']['rec_id'];
    $tenantId = $_SESSION['user']['tenant_id'] ?? '00000000-0000-0000-0000-000000000001';
}

function returnJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// --- HELPERS ---
function logChange($pdo, $recId, $field, $old, $new, $by) {
    if ($old == $new) return;
    try {
        $stmt = $pdo->prepare("INSERT INTO sys_change_history (ref_table_id, ref_rec_id, field_name, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([TABLE_ID_CR, $recId, $field, (string)$old, (string)$new, $by]);
    } catch(Exception $e) {}
}

try {
    $pdo = DB::connect();
    
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    // === LIST REQUESTS ===
    if ($action === 'list' && $method === 'GET') {
        $isAdmin = true; // Todo: Check role
        
        // Select with aliases for Frontend compatibility
        $sql = "SELECT cr.rec_id as id, cr.subject, cr.description, cr.priority, cr.status, cr.created_at, 
                       u.full_name as username, 
                       au.full_name as assigned_username, cr.assigned_to,
                       (SELECT COUNT(*) FROM sys_change_requests_files f WHERE f.cr_id = cr.rec_id) as attachment_count
                FROM sys_change_requests cr
                LEFT JOIN sys_users u ON cr.created_by = u.rec_id
                LEFT JOIN sys_users au ON cr.assigned_to = au.rec_id
                WHERE cr.tenant_id = :tid";
        
        $sql .= " ORDER BY cr.created_at DESC";
        
        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(':tid', $tenantId);
        
        $stmt->execute();
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === CREATE REQUEST ===
    if ($action === 'create' && $method === 'POST') {
        $subject = $_POST['subject'] ?? '';
        $desc = $_POST['description'] ?? '';
        $priority = $_POST['priority'] ?? 'medium';
        
        if (!$subject) returnJson(['error' => 'Subject is required'], 400);
        
        // Transaction to ensure CR and Files are saved together
        DB::transaction(function($pdo) use ($subject, $desc, $priority, $userId, $tenantId) {
            // 1. Insert CR
            $stmt = $pdo->prepare("INSERT INTO sys_change_requests (tenant_id, subject, description, priority, created_by, status) VALUES (?, ?, ?, ?, ?, 'New') RETURNING rec_id");
            $stmt->execute([$tenantId, $subject, $desc, $priority, $userId]);
            $recId = $stmt->fetchColumn();
            
            logChange($pdo, $recId, 'status', '', 'New', $userId);
            
            // 2. Handle Attachments
            if (isset($_FILES['attachments'])) {
                $files = $_FILES['attachments'];
                // Normalize $_FILES structure if needed (checking if multiple)
                if (is_array($files['name'])) {
                    for ($i = 0; $i < count($files['name']); $i++) {
                        if ($files['error'][$i] === UPLOAD_ERR_OK) {
                            $name = $files['name'][$i];
                            $type = $files['type'][$i];
                            $tmp = $files['tmp_name'][$i];
                            $size = $files['size'][$i];
                            
                            // Limit 5MB per file
                            if ($size > 5 * 1024 * 1024) continue;
                            
                            $content = base64_encode(file_get_contents($tmp));
                            
                            $fStmt = $pdo->prepare("INSERT INTO sys_change_requests_files (cr_id, file_name, file_type, file_size, file_data) VALUES (?, ?, ?, ?, ?)");
                            $fStmt->execute([$recId, $name, $type, $size, $content]);
                        }
                    }
                }
            }
            
            returnJson(['success' => true, 'id' => $recId]);
        });
    }

    // === UPDATE REQUEST ===
    if ($action === 'update' && ($method === 'POST' || $method === 'PUT')) {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $recId = $input['id'] ?? null;
        
        if (!$recId) returnJson(['error' => 'ID missing'], 400);
        
        // Fetch current
        $currStmt = $pdo->prepare("SELECT * FROM sys_change_requests WHERE rec_id = ? AND tenant_id = ?");
        $currStmt->execute([$recId, $tenantId]);
        $curr = $currStmt->fetch();
        if (!$curr) returnJson(['error' => 'Not found'], 404);
        
        DB::transaction(function($pdo) use ($input, $curr, $userId, $recId) {
             if (isset($input['status']) && $input['status'] !== $curr['status']) {
                 $pdo->prepare("UPDATE sys_change_requests SET status = ? WHERE rec_id = ?")->execute([$input['status'], $recId]);
                 logChange($pdo, $recId, 'status', $curr['status'], $input['status'], $userId);
             }
             if (isset($input['assigned_to'])) {
                 $pdo->prepare("UPDATE sys_change_requests SET assigned_to = ? WHERE rec_id = ?")->execute([$input['assigned_to'], $recId]);
                 logChange($pdo, $recId, 'assigned_to', $curr['assigned_to'], $input['assigned_to'], $userId);
             }
             
             // Return updated username for assignee
             $assignedName = null;
             if (isset($input['assigned_to'])) {
                 $uStmt = $pdo->prepare("SELECT full_name FROM sys_users WHERE rec_id = ?");
                 $uStmt->execute([$input['assigned_to']]);
                 $assignedName = $uStmt->fetchColumn();
             }

             returnJson(['success' => true, 'assigned_username' => $assignedName]);
        });
    }
    
    // === LIST USERS (For Assignee Dropdown) ===
    if ($action === 'list_users') {
        $stmt = $pdo->prepare("SELECT rec_id as id, full_name as username FROM sys_users WHERE tenant_id = ? ORDER BY full_name");
        $stmt->execute([$tenantId]);
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    returnJson(['error' => 'Invalid Action'], 404);

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server Error: ' . $e->getMessage()], 500);
}
