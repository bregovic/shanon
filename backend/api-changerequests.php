<?php
// backend/api-changerequests.php
// Shanon Enterprise Change Management API

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';
require_once 'ImageOptimizer.php';

header("Content-Type: application/json");

// --- CONFIG ---
const TABLE_ID_CR = 100; // SysTableId for ChangeRequests

// --- AUTH ---
if (!isset($_SESSION['loggedin']) || !isset($_SESSION['user'])) {
    // Basic fallback for dev (should be stricter in prod)
    $userId = 1; 
    $tenantId = '00000000-0000-0000-0000-000000000001';
} else {
    $userId = $_SESSION['user']['id'] ?? $_SESSION['user_id'] ?? null;
    // POUZE PROZATIMNÍ FIX: Ignorujeme skutečné tenant_id ze session, aby byla vidět stará data.
    // TODO: Zmigrovat data ze '0000...0001' na skutečné tenanty a pak to vrátit.
    $tenantId = '00000000-0000-0000-0000-000000000001';
    
    if (!$userId) {
        returnJson(['error' => 'User session invalid'], 401);
    }
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
        
        $view = $_GET['view'] ?? 'mine'; // Default to mine if not specified (frontend sends view=all for all)
        if ($view !== 'all') {
            $sql .= " AND (cr.created_by = :uid OR cr.assigned_to = :uid)";
        }
        
        $sql .= " ORDER BY cr.created_at DESC";
        
        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(':tid', $tenantId);
        if ($view !== 'all') {
            $stmt->bindValue(':uid', $userId);
        }
        
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
             
             if (isset($input['subject']) && $input['subject'] !== $curr['subject']) {
                 $pdo->prepare("UPDATE sys_change_requests SET subject = ? WHERE rec_id = ?")->execute([$input['subject'], $recId]);
                 logChange($pdo, $recId, 'subject', $curr['subject'], $input['subject'], $userId);
             }
             if (isset($input['description']) && $input['description'] !== $curr['description']) {
                 $pdo->prepare("UPDATE sys_change_requests SET description = ? WHERE rec_id = ?")->execute([$input['description'], $recId]);
                 logChange($pdo, $recId, 'description', $curr['description'], $input['description'], $userId);
             }
             if (isset($input['priority']) && $input['priority'] !== $curr['priority']) {
                 $pdo->prepare("UPDATE sys_change_requests SET priority = ? WHERE rec_id = ?")->execute([$input['priority'], $recId]);
                 logChange($pdo, $recId, 'priority', $curr['priority'], $input['priority'], $userId);
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
                    
                    if ($size > 15 * 1024 * 1024) continue; // 15MB upload limit (will be optimized)

                    // Optimize Image
                    ImageOptimizer::optimize($tmp, $tmp, 80, 1920, 1920);
                    clearstatcache();
                    $size = filesize($tmp);

                    
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

    // === DELETE ATTACHMENT ===
    if ($action === 'delete_attachment' && $method === 'POST') {
        // Support JSON body AND FormData, key 'file_id' OR 'id'
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $fileId = $input['file_id'] ?? $input['id'] ?? $_POST['file_id'] ?? $_POST['id'] ?? null;
        
        if (!$fileId) returnJson(['error' => 'file_id required'], 400);

        // Secure Delete: Check if file belongs to a request owned by tenant
        $stmt = $pdo->prepare("DELETE FROM sys_change_requests_files WHERE rec_id = ? AND cr_id IN (SELECT rec_id FROM sys_change_requests WHERE tenant_id = ?)");
        $stmt->execute([$fileId, $tenantId]);
        
        if ($stmt->rowCount() > 0) {
            returnJson(['success' => true]);
        } else {
            returnJson(['error' => 'Not found or access denied'], 404);
        }
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

            // 1b. Delete Comments
            // Ensure table exists just in case (though list/add handles creation)
            // But for delete, we just try. If table missing, it throws.
            // Let's assume table exists if we are deleting. Use try catch or just standard execution.
            try {
                $stmtComments = $pdo->prepare("DELETE FROM sys_change_comments WHERE cr_id IN ($ownerSubquery)");
                $stmtComments->execute($baseParams);
            } catch (Exception $ignore) {}

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

    // === LIST COMMENTS ===
    if ($action === 'list_comments' && $method === 'GET') {
        $requestId = $_GET['request_id'] ?? null;
        if (!$requestId) returnJson(['error' => 'request_id required'], 400);

        $stmt = $pdo->prepare("
            SELECT c.rec_id as id, c.comment, c.created_at, 
                   u.full_name as username, c.user_id,
                   (
                       SELECT json_object_agg(reaction_type, user_ids)
                       FROM (
                           SELECT reaction_type, json_agg(user_id) as user_ids
                           FROM sys_change_comment_reactions
                           WHERE comment_id = c.rec_id
                           GROUP BY reaction_type
                       ) sub
                   ) as reactions_json,
                   (
                       SELECT json_agg(reaction_type)
                       FROM sys_change_comment_reactions
                       WHERE comment_id = c.rec_id AND user_id = :uid
                   ) as user_reactions_json
            FROM sys_change_comments c
            LEFT JOIN sys_users u ON c.user_id = u.rec_id
            WHERE c.cr_id = :rid
            ORDER BY c.created_at ASC
        ");
        $stmt->bindValue(':rid', $requestId);
        $stmt->bindValue(':uid', $userId);
        $stmt->execute();
        
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Decode JSON columns manually (PDO returns strings)
        foreach ($data as &$row) {
            $row['reactions'] = $row['reactions_json'] ? json_decode($row['reactions_json'], true) : [];
            $row['user_reactions'] = $row['user_reactions_json'] ? json_decode($row['user_reactions_json'], true) : [];
            unset($row['reactions_json']);
            unset($row['user_reactions_json']);
        }

        returnJson(['success' => true, 'data' => $data]);
    }

    // === TOGGLE REACTION ===
    if ($action === 'toggle_reaction' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $commentId = $input['comment_id'] ?? null;
        $type = $input['type'] ?? null;
        
        if (!$commentId || !$type) returnJson(['error' => 'Missing data'], 400);

        // Check if exists
        $stmt = $pdo->prepare("SELECT rec_id FROM sys_change_comment_reactions WHERE comment_id = ? AND user_id = ? AND reaction_type = ?");
        $stmt->execute([$commentId, $userId, $type]);
        $existing = $stmt->fetchColumn();

        if ($existing) {
            $pdo->prepare("DELETE FROM sys_change_comment_reactions WHERE rec_id = ?")->execute([$existing]);
        } else {
            $pdo->prepare("INSERT INTO sys_change_comment_reactions (comment_id, user_id, reaction_type) VALUES (?, ?, ?)")
                ->execute([$commentId, $userId, $type]);
        }
        returnJson(['success' => true]);
    }

    // === UPDATE COMMENT ===
    if ($action === 'update_comment' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $id = $input['id'] ?? null;
        $text = $input['comment'] ?? null;
        
        if (!$id || !$text) returnJson(['error' => 'Missing data'], 400);

        // Access check
        $stmt = $pdo->prepare("SELECT user_id FROM sys_change_comments WHERE rec_id = ?");
        $stmt->execute([$id]);
        $owner = $stmt->fetchColumn();
        
        if ($owner != $userId) returnJson(['error' => 'Unauthorized'], 403);
        
        $pdo->prepare("UPDATE sys_change_comments SET comment = ? WHERE rec_id = ?")->execute([$text, $id]);
        returnJson(['success' => true]);
    }

    // === DELETE COMMENT ===
    if ($action === 'delete_comment' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $id = $input['id'] ?? null;
        
        if (!$id) returnJson(['error' => 'Missing data'], 400);
        
        // Access check
        $stmt = $pdo->prepare("SELECT user_id FROM sys_change_comments WHERE rec_id = ?");
        $stmt->execute([$id]);
        $owner = $stmt->fetchColumn();
        
        // Allow if owner OR current user is admin (role check simplified)
        // Assume userId 1 or 'admin' role. But simpler is just owner for now.
        // Or if user is the AI Agent (which is ID v_ai_id).
        
        if ($owner != $userId) returnJson(['error' => 'Unauthorized'], 403);
        
        $pdo->prepare("DELETE FROM sys_change_comments WHERE rec_id = ?")->execute([$id]);
        returnJson(['success' => true]);
    }

    // === ADD COMMENT ===
    if ($action === 'add_comment' && $method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $requestId = $input['request_id'] ?? $_POST['request_id'] ?? null;
        $comment = $input['comment'] ?? $_POST['comment'] ?? null;

        if (!$requestId || !$comment) returnJson(['error' => 'Missing data'], 400);

        // Table created via migration 010_sys_change_comments

        $stmt = $pdo->prepare("INSERT INTO sys_change_comments (cr_id, user_id, comment) VALUES (?, ?, ?)");
        $stmt->execute([$requestId, $userId, $comment]);
        
        logChange($pdo, $requestId, 'comment', '', 'Added comment', $userId);
        
        returnJson(['success' => true]);
    }

    returnJson(['error' => 'Invalid Action'], 404);

} catch (Throwable $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server Error: ' . $e->getMessage()], 500);
}
