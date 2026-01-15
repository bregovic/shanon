<?php
// backend/api-settings.php - User Settings Endpoint
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

$userId = $_SESSION['user']['id'] ?? $_SESSION['user']['rec_id'];

try {
    $pdo = DB::connect();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        // Fetch current settings
        $stmt = $pdo->prepare("SELECT settings FROM sys_users WHERE rec_id = :id");
        $stmt->execute([':id' => $userId]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        $settings = $result && $result['settings'] ? json_decode($result['settings'], true) : [];
        
        echo json_encode(['success' => true, 'settings' => $settings]);
    
    } elseif ($method === 'POST') {
        // Update settings
        $input = json_decode(file_get_contents('php://input'), true);
        
        // Merge with existing settings? Or replace? 
        // Let's fetch existing first to be safe and merge essential keys
        $stmt = $pdo->prepare("SELECT settings FROM sys_users WHERE rec_id = :id");
        $stmt->execute([':id' => $userId]);
        $current = $stmt->fetch(PDO::FETCH_ASSOC);
        $currentSettings = $current && $current['settings'] ? json_decode($current['settings'], true) : [];
        
        // Update known keys
        if (isset($input['language'])) $currentSettings['language'] = $input['language'];
        if (isset($input['theme'])) $currentSettings['theme'] = $input['theme'];
        
        $newJson = json_encode($currentSettings);
        
        $stmt = $pdo->prepare("UPDATE sys_users SET settings = :json, updated_at = NOW() WHERE rec_id = :id");
        $stmt->execute([':json' => $newJson, ':id' => $userId]);
        
        echo json_encode(['success' => true, 'message' => 'Settings saved']);
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
