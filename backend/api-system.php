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

    } elseif ($action === 'setup') {
        $sql = "CREATE TABLE IF NOT EXISTS sys_translations (
            rec_id SERIAL PRIMARY KEY,
            table_name VARCHAR(64) NOT NULL,
            record_id INTEGER NOT NULL,
            language_code VARCHAR(10) NOT NULL,
            translation TEXT NOT NULL,
            field_name VARCHAR(64) DEFAULT 'name',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )";
        $pdo->exec($sql);
        
        $sqlIndex = "CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_translations_unique ON sys_translations (table_name, record_id, language_code, field_name)";
        $pdo->exec($sqlIndex);

        echo json_encode(['success' => true, 'message' => 'System tables setup complete']);

    } elseif ($action === 'translations_list') {
        $where = [];
        $params = [];
        
        if (!empty($_GET['table_name'])) {
            $where[] = "table_name = :tbl";
            $params[':tbl'] = $_GET['table_name'];
        }
        if (!empty($_GET['record_id'])) {
            $where[] = "record_id = :rid";
            $params[':rid'] = $_GET['record_id'];
        }

        $sql = "SELECT * FROM sys_translations";
        if (!empty($where)) {
            $sql .= " WHERE " . implode(" AND ", $where);
        }
        $sql .= " ORDER BY created_at DESC";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);

    } elseif ($action === 'translation_save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        
        $tableName = $input['table_name'] ?? '';
        $recordId = (int)($input['record_id'] ?? 0);
        $lang = $input['language_code'] ?? '';
        $trans = $input['translation'] ?? '';
        $field = $input['field_name'] ?? 'name';

        if (!$tableName || !$recordId || !$lang) {
            throw new Exception('Missing required fields');
        }

        // Upsert
        $sql = "INSERT INTO sys_translations (table_name, record_id, language_code, field_name, translation)
                VALUES (:tbl, :rid, :lang, :field, :val)
                ON CONFLICT (table_name, record_id, language_code, field_name)
                DO UPDATE SET translation = EXCLUDED.translation";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tbl' => $tableName,
            ':rid' => $recordId,
            ':lang' => $lang,
            ':field' => $field,
            ':val' => $trans
        ]);
        
        echo json_encode(['success' => true]);

    } elseif ($action === 'translation_delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        
        if ($id) {
            $stmt = $pdo->prepare("DELETE FROM sys_translations WHERE rec_id = :id");
            $stmt->execute([':id' => $id]);
        }
        echo json_encode(['success' => true]);

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
