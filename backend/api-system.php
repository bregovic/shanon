<?php
// backend/api-system.php
// System Configuration & Diagnostics Endpoint

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

// Security: Only logged-in admins can access system config
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// In future: Check for admin role
// if (($_SESSION['user']['role'] ?? '') !== 'admin') { ... }

$action = $_GET['action'] ?? 'diagnostics';

try {
    $pdo = DB::connect();

    if ($action === 'diagnostics') {
        // 1. Session Diagnostics
        $sessionId = session_id();
        $sessionInDb = false;
        $sessionDataLen = 0;
        
        $stmt = $pdo->prepare("SELECT data FROM sys_sessions WHERE id = :id");
        $stmt->execute([':id' => $sessionId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($row) {
            $sessionInDb = true;
            $sessionDataLen = strlen($row['data']);
        }

        // 2. Cookie Params
        $cookieParams = session_get_cookie_params();

        // 3. System Info
        $diagnostics = [
            'overview' => [
                'php_version' => phpversion(),
                'server_software' => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown',
                'db_status' => 'Connected',
                'server_time' => date('Y-m-d H:i:s'),
            ],
            'session' => [
                'id' => $sessionId,
                'handler' => ini_get('session.save_handler'), // Should be 'user' for custom handler
                'persisted_in_db' => $sessionInDb,
                'data_length' => $sessionDataLen,
                'cookie_params' => $cookieParams,
                'current_user' => $_SESSION['user'] ?? 'Unknown'
            ],
            'request' => [
                'is_https' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
                'remote_addr' => $_SERVER['REMOTE_ADDR']
            ]
        ];

        echo json_encode(['success' => true, 'data' => $diagnostics]);
    } else {
        throw new Exception("Unknown action: $action");
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'db_status' => 'Disconnected'
    ]);
}
