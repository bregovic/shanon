<?php
// backend/api-system.php
// System Configuration & Diagnostics Endpoint

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

// PERFORMANCE FIX: Close session lock immediately after start, as we only read or debug.
session_write_close();

header('Content-Type: application/json');

// Security Bypass for debugging with token
$debugToken = $_GET['token'] ?? '';
$isDebugAuth = ($debugToken === 'shanon2026install');

// Standard Auth Check
// Accessing $_SESSION is safe even after session_write_close()
if (!$isDebugAuth && (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true)) {
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
        
        // We re-query DB manually to check persistence
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
                'status' => session_status(),
                'id' => $sessionId,
                'cookie_received' => $_COOKIE[session_name()] ?? 'NOT_RECEIVED',
                'handler' => ini_get('session.save_handler'),
                'persisted_in_db' => $sessionInDb,
                'data_length' => $sessionDataLen,
                'cookie_params' => $cookieParams,
            ],
            'request' => [
                'is_https' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
                'remote_addr' => $_SERVER['REMOTE_ADDR']
            ]
        ];

        echo json_encode(['success' => true, 'data' => $diagnostics]);
    } elseif ($action === 'get_doc') {
        $file = $_GET['file'] ?? '';
        $map = [
            'manifest' => __DIR__ . '/../.agent/MANIFEST.md',
            'security' => __DIR__ . '/../.agent/SECURITY.md',
            'database' => __DIR__ . '/../.agent/DATABASE.md'
        ];

        if (!isset($map[$file]) || !file_exists($map[$file])) {
            throw new Exception("Document not found or access denied.");
        }

        $content = file_get_contents($map[$file]);
        echo json_encode(['success' => true, 'content' => $content]);

    } elseif ($action === 'history') {
        // Fetch Development History
        $stmt = $pdo->query("SELECT * FROM development_history ORDER BY date DESC, id DESC LIMIT 50");
        $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch recent CRs
        $stmt2 = $pdo->query("SELECT * FROM sys_change_requests ORDER BY created_at DESC LIMIT 20");
        $requests = $stmt2->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'history' => $history, 'requests' => $requests]);

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
