<?php
// backend/api-dms.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

if (!isset($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$action = $_GET['action'] ?? 'list';

try {
    if ($action === 'list') {
        $sql = "SELECT d.*, t.name as doc_type_name, u.full_name as uploaded_by_name
                FROM dms_documents d
                LEFT JOIN dms_doc_types t ON d.doc_type_id = t.rec_id
                LEFT JOIN sys_users u ON d.created_by = u.rec_id
                ORDER BY d.created_at DESC LIMIT 100";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $docs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode(['success' => true, 'data' => $docs]);
    }
    
    // Placeholder for other actions (create_type, upload, etc.)

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
