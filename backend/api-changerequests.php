<?php
// backend/api-changerequests.php
// Shanon Enterprise Change Management API

require_once 'db.php';

// --- CONFIG ---
const TABLE_ID_CR = 100; // SysTableId for ChangeRequests

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

function returnJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// --- MOCK AUTH (TODO: Validate Session) ---
// For now, assume session is started in index.php or cors.php
session_start();
$userId = $_SESSION['user_id'] ?? 1; // Fallback for dev
$tenantId = $_SESSION['tenant_id'] ?? '00000000-0000-0000-0000-000000000000'; // Default Tenant

// --- HELPERS ---
function logChange($pdo, $recId, $field, $old, $new, $by) {
    if ($old == $new) return;
    $stmt = $pdo->prepare("INSERT INTO sys_change_history (ref_table_id, ref_rec_id, field_name, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->execute([TABLE_ID_CR, $recId, $field, (string)$old, (string)$new, $by]);
}

try {
    $pdo = DB::connect();
    
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    // === LIST REQUESTS ===
    if ($action === 'list' && $method === 'GET') {
        // RLS: User sees only his requests, Admin sees all (within tenant)
        // Todo: Implement Real Role Check from DB
        $isAdmin = true; // Temporary
        
        $sql = "SELECT cr.*, u.full_name as constructed_by_name, au.full_name as assigned_to_name 
                FROM sys_change_requests cr
                LEFT JOIN sys_users u ON cr.created_by = u.rec_id
                LEFT JOIN sys_users au ON cr.assigned_to = au.rec_id
                WHERE cr.tenant_id = :tid";
                
        if (!$isAdmin) {
             $sql .= " AND cr.created_by = :uid";
        }
        
        $sql .= " ORDER BY cr.created_at DESC";
        
        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(':tid', $tenantId);
        if (!$isAdmin) $stmt->bindValue(':uid', $userId);
        
        $stmt->execute();
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === CREATE REQUEST ===
    if ($action === 'create' && $method === 'POST') {
        $subject = $_POST['subject'] ?? '';
        $desc = $_POST['description'] ?? '';
        $priority = $_POST['priority'] ?? 'medium';
        
        if (!$subject) returnJson(['error' => 'Subject is required'], 400);
        
        DB::transaction(function($pdo) use ($subject, $desc, $priority, $userId, $tenantId) {
            $stmt = $pdo->prepare("INSERT INTO sys_change_requests (tenant_id, subject, description, priority, created_by, status) VALUES (?, ?, ?, ?, ?, 'New') RETURNING rec_id");
            $stmt->execute([$tenantId, $subject, $desc, $priority, $userId]);
            $recId = $stmt->fetchColumn();
            
            // Handle Attachments (Metadata Driven)
            // TODO: Implement generic attachment handler
            
            logChange($pdo, $recId, 'status', '', 'New', $userId);
            
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
             // Logic to update fields and log history...
             // Simplified for brevity
             if (isset($input['status']) && $input['status'] !== $curr['status']) {
                 $pdo->prepare("UPDATE sys_change_requests SET status = ? WHERE rec_id = ?")->execute([$input['status'], $recId]);
                 logChange($pdo, $recId, 'status', $curr['status'], $input['status'], $userId);
             }
             // ... other fields
             returnJson(['success' => true]);
        });
    }

    returnJson(['error' => 'Invalid Action'], 404);

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server Error'], 500);
}
