<?php
// backend/api-system.php
// System Configuration & Diagnostics Endpoint

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

// Security Bypass for debugging with token
$debugToken = $_GET['token'] ?? '';
$isDebugAuth = ($debugToken === 'shanon2026install');

// Standard Auth Check
if (!$isDebugAuth && (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true)) {
    // Return detailed info on WHY unauthorized for debugging purposes (if safe) or just generic
    http_response_code(401);
    echo json_encode([
        'success' => false, 
        'error' => 'Unauthorized',
        'debug_hint' => [
            'session_id' => session_id(),
            'has_cookie' => isset($_COOKIE[session_name()]),
            'cookie_name' => session_name(),
            'session_data_exists' => !empty($_SESSION)
        ]
    ]);
    exit;
}

$action = $_GET['action'] ?? 'diagnostics';

try {
    $pdo = DB::connect();

    if ($action === 'diagnostics') {
        // 1. Session Diagnostics
        $sessionId = session_id();
        $sessionInDb = false;
        $sessionDataLen = 0;
        $dbData = null;
        
        $stmt = $pdo->prepare("SELECT data FROM sys_sessions WHERE id = :id");
        $stmt->execute([':id' => $sessionId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($row) {
            $sessionInDb = true;
            $sessionDataLen = strlen($row['data']);
            $dbData = $row['data'];
        }

        // 2. Cookie Params
        $cookieParams = session_get_cookie_params();

        // 3. System Info
        $diagnostics = [
            'overview' => [
                'php_version' => phpversion(),
                'server_software' => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown',
                'db_status' => 'Connected to ' . $pdo->getAttribute(PDO::ATTR_DRIVER_NAME),
                'server_time' => date('Y-m-d H:i:s'),
            ],
            'session' => [
                'status' => session_status(),
                'id' => $sessionId,
                'cookie_received' => $_COOKIE[session_name()] ?? 'NOT_RECEIVED',
                'handler' => ini_get('session.save_handler'),
                'persisted_in_db' => $sessionInDb,
                'data_length' => $sessionDataLen,
                'session_vars' => $_SESSION, // Careful exposing this, but useful for debug
                'cookie_params' => $cookieParams,
            ],
            'request' => [
                'is_https' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
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
