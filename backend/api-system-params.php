<?php
// api-system-params.php
require_once 'db.php';
require_once 'cors.php';
session_start();

$user_id = $_SESSION['user_id'] ?? null;
if (!$user_id) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$action = $_GET['action'] ?? 'list';

try {
    $db = DB::connect();

    if ($action === 'list') {
        $stmt = $db->query("SELECT param_key, param_value, description FROM sys_parameters ORDER BY param_key");
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
    } 
    elseif ($action === 'update') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) throw new Exception("Invalid JSON");
        
        $key = $input['key'] ?? '';
        $value = $input['value'] ?? '';
        
        if (empty($key)) throw new Exception("Missing key");

        // Simple upsert
        $stmt = $db->prepare("
            INSERT INTO sys_parameters (param_key, param_value) 
            VALUES (?, ?)
            ON CONFLICT (param_key) 
            DO UPDATE SET param_value = EXCLUDED.param_value
        ");
        $stmt->execute([$key, $value]);
        
        echo json_encode(['success' => true]);
    }
    else {
        throw new Exception("Unknown action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
