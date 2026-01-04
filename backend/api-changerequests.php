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
        
        // FIX: Capture result, do NOT returnJson inside transaction
        $result = DB::transaction(function($pdo) use ($subject, $desc, $priority, $userId, $tenantId) {
            // 1. Insert CR
            $stmt = $pdo->prepare("INSERT INTO sys_change_requests (tenant_id, subject, description, priority, created_by, status) VALUES (?, ?, ?, ?, ?, 'New') RETURNING rec_id");
            $stmt->execute([$tenantId, $subject, $desc, $priority, $userId]);
            $recId = $stmt->fetchColumn();
            
            logChange($pdo, $recId, 'status', '', 'New', $userId);
            
            // 2. Handle Attachments
            if (isset($_FILES['attachments'])) {
                $files = $_FILES['attachments'];
                if (isset($files['name']) && is_array($files['name'])) {
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
            // Return data to bubble up
            return ['success' => true, 'id' => $recId];
        });

        // Send response AFTER commit
        returnJson($result);
    }

    // === UPLOAD CONTENT IMAGE ===
    if ($action === 'upload_content_image' && $method === 'POST') {
        $file = $_FILES['image'] ?? $_FILES['file'] ?? null;
        
        if ($file && $file['error'] === UPLOAD_ERR_OK) {
             $type = $file['type'];
             $data = base64_encode(file_get_contents($file['tmp_name']));
             $url = "data:$type;base64,$data";
             returnJson(['url' => $url]);
        }
        returnJson(['error' => 'No file uploaded'], 400);
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
        
        $result = DB::transaction(function($pdo) use ($input, $curr, $userId, $recId) {
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

             return ['success' => true, 'assigned_username' => $assignedName];
        });

        returnJson($result);
    }
    
    // === LIST USERS ===
    if ($action === 'list_users') {
        $stmt = $pdo->prepare("SELECT rec_id as id, full_name as username FROM sys_users WHERE tenant_id = ? ORDER BY full_name");
        $stmt->execute([$tenantId]);
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === GET HISTORY (Audit Log) ===
    if ($action === 'get_history' && $method === 'GET') {
        $requestId = $_GET['request_id'] ?? null;
        if (!$requestId) returnJson(['error' => 'request_id required'], 400);
        
        $stmt = $pdo->prepare("
            SELECT h.rec_id as id, h.field_name as change_type, h.old_value, h.new_value, h.changed_at as created_at,
                   u.full_name as username
            FROM sys_change_history h
            LEFT JOIN sys_users u ON h.changed_by = u.rec_id
            WHERE h.ref_table_id = ? AND h.ref_rec_id = ?
            ORDER BY h.changed_at DESC
        ");
        $stmt->execute([TABLE_ID_CR, $requestId]);
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === LIST ATTACHMENTS ===
    if ($action === 'list_attachments' && $method === 'GET') {
        $requestId = $_GET['request_id'] ?? null;
        if (!$requestId) returnJson(['error' => 'request_id required'], 400);
        
        $stmt = $pdo->prepare("
            SELECT rec_id as id, cr_id as request_id, file_name as filename, file_type, file_size as filesize, uploaded_at as created_at
            FROM sys_change_requests_files
            WHERE cr_id = ?
            ORDER BY uploaded_at DESC
        ");
        $stmt->execute([$requestId]);
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === ADD ATTACHMENT ===
    if ($action === 'add_attachment' && $method === 'POST') {
        $requestId = $_POST['request_id'] ?? null;
        if (!$requestId) returnJson(['error' => 'request_id required'], 400);
        
        // Verify request belongs to tenant
        $check = $pdo->prepare("SELECT rec_id FROM sys_change_requests WHERE rec_id = ? AND tenant_id = ?");
        $check->execute([$requestId, $tenantId]);
        if (!$check->fetch()) returnJson(['error' => 'Not found'], 404);
        
        $files = $_FILES['files'] ?? null;
        if (!$files) returnJson(['error' => 'No files'], 400);
        
        $uploaded = [];
        if (isset($files['name']) && is_array($files['name'])) {
            for ($i = 0; $i < count($files['name']); $i++) {
                if ($files['error'][$i] === UPLOAD_ERR_OK) {
                    $name = $files['name'][$i];
                    $type = $files['type'][$i];
                    $tmp = $files['tmp_name'][$i];
                    $size = $files['size'][$i];
                    
                    if ($size > 5 * 1024 * 1024) continue; // 5MB limit
                    
                    $content = base64_encode(file_get_contents($tmp));
                    
                    $fStmt = $pdo->prepare("INSERT INTO sys_change_requests_files (cr_id, file_name, file_type, file_size, file_data) VALUES (?, ?, ?, ?, ?) RETURNING rec_id");
                    $fStmt->execute([$requestId, $name, $type, $size, $content]);
                    $fileId = $fStmt->fetchColumn();
                    
                    $uploaded[] = ['id' => $fileId, 'filename' => $name, 'filesize' => $size];
                }
            }
        } elseif (isset($files['name'])) {
            // Single file
            if ($files['error'] === UPLOAD_ERR_OK) {
                $name = $files['name'];
                $type = $files['type'];
                $tmp = $files['tmp_name'];
                $size = $files['size'];
                
                if ($size <= 5 * 1024 * 1024) {
                    $content = base64_encode(file_get_contents($tmp));
                    
                    $fStmt = $pdo->prepare("INSERT INTO sys_change_requests_files (cr_id, file_name, file_type, file_size, file_data) VALUES (?, ?, ?, ?, ?) RETURNING rec_id");
                    $fStmt->execute([$requestId, $name, $type, $size, $content]);
                    $fileId = $fStmt->fetchColumn();
                    
                    $uploaded[] = ['id' => $fileId, 'filename' => $name, 'filesize' => $size];
                }
            }
        }
        
        returnJson(['success' => true, 'files' => $uploaded]);
    }

    // === DOWNLOAD ATTACHMENT ===
    if ($action === 'download_attachment' && $method === 'GET') {
        $fileId = $_GET['file_id'] ?? null;
        if (!$fileId) returnJson(['error' => 'file_id required'], 400);
        
        $stmt = $pdo->prepare("
            SELECT f.file_name, f.file_type, f.file_data
            FROM sys_change_requests_files f
            JOIN sys_change_requests cr ON f.cr_id = cr.rec_id
            WHERE f.rec_id = ? AND cr.tenant_id = ?
        ");
        $stmt->execute([$fileId, $tenantId]);
        $file = $stmt->fetch();
        
        if (!$file) returnJson(['error' => 'Not found'], 404);
        
        header('Content-Type: ' . $file['file_type']);
        header('Content-Disposition: attachment; filename="' . $file['file_name'] . '"');
        echo base64_decode($file['file_data']);
        exit;
    }

    // === DELETE REQUEST ===
    if ($action === 'delete_request' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $ids = $input['ids'] ?? [];
        if (!is_array($ids)) $ids = [$ids];
        $ids = array_filter($ids, function($id) { return is_numeric($id); });

        if (empty($ids)) returnJson(['error' => 'No IDs provided'], 400);

        // Transaction
        DB::transaction(function($pdo) use ($ids, $tenantId) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            
            // Valid Request IDs owned by tenant (subquery logic)
            $ownerSubquery = "SELECT rec_id FROM sys_change_requests WHERE rec_id IN ($placeholders) AND tenant_id = ?";
            $baseParams = array_merge(array_values($ids), [$tenantId]);
            
            // 1. Delete Files
            $stmtFiles = $pdo->prepare("DELETE FROM sys_change_requests_files WHERE cr_id IN ($ownerSubquery)");
            $stmtFiles->execute($baseParams);

            // 2. Delete History (ref_table_id = TABLE_ID_CR)
            $historyParams = array_merge([TABLE_ID_CR], array_values($ids), [$tenantId]);
            $stmtHistory = $pdo->prepare("DELETE FROM sys_change_history WHERE ref_table_id = ? AND ref_rec_id IN ($ownerSubquery)");
            $stmtHistory->execute($historyParams);

            // 3. Delete Requests
            $stmtReq = $pdo->prepare("DELETE FROM sys_change_requests WHERE rec_id IN ($placeholders) AND tenant_id = ?");
            $stmtReq->execute($baseParams);
        });

        returnJson(['success' => true]);
    }

    returnJson(['error' => 'Invalid Action'], 404);

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server Error: ' . $e->getMessage()], 500);
}
