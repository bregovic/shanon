<?php
// backend/api-dms.php
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "DEBUG: Starting...\n";

require_once 'cors.php';
echo "DEBUG: cors loaded\n";

require_once 'session_init.php';
echo "DEBUG: session loaded\n";

require_once 'db.php';
echo "DEBUG: db loaded\n";

require_once 'helpers/OcrEngine.php';
echo "DEBUG: ocr loaded\n";

// header("Content-Type: application/json"); // Disabled for debug output visibility

$action = $_GET['action'] ?? 'list';
echo "DEBUG: Action is $action\n";

if (!isset($_SESSION['loggedin']) && $action !== 'debug_setup') {
    http_response_code(401);
    echo "DEBUG: Unauthorized\n";
    exit;
}

$userId = $_SESSION['user']['rec_id'] ?? null;
echo "DEBUG: User ID: $userId\n";

try {
    $pdo = DB::connect();
    echo "DEBUG: DB Connected\n";

    // ===== DEBUG SETUP: CREATE TABLES (MIGRATED TO install-db.php) =====
    if ($action === 'debug_setup') {
        echo json_encode(['success' => false, 'message' => 'Use install-db.php instead.']);
        exit;
    }

    // ===== LIST DOCUMENTS =====
    if ($action === 'list') {
        echo "DEBUG: Executing list...\n";
        $sql = "SELECT d.*, t.name as doc_type_name, u.full_name as uploaded_by_name
                FROM dms_documents d
                LEFT JOIN dms_doc_types t ON d.doc_type_id = t.rec_id
                LEFT JOIN sys_users u ON d.created_by = u.rec_id
                ORDER BY d.created_at DESC LIMIT 100";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $docs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo "DEBUG: Fetch count: " . count($docs) . "\n";
        
        $json = json_encode(['success' => true, 'data' => $docs], JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) {
            echo "DEBUG: JSON Encode Failed: " . json_last_error_msg();
        } else {
            // echo "DEBUG: JSON OK. Outputting...\n";
            // Clear debug output to try a valid response? No, let's keep debug text for now.
            echo $json;
        }
        exit;
    }

    // ===== LIST DOCUMENT TYPES =====
    if ($action === 'types' || $action === 'doc_types') {
         echo "DEBUG: Executing types...\n";
        $stmt = $pdo->query("SELECT * FROM dms_doc_types ORDER BY name");
        $types = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $types]);
        exit;
    }

    // ===== STORAGE PROFILE (For Upload) =====
    if ($action === 'storage_profiles') {
        echo "DEBUG: Executing profiles...\n";
        // Mock profiles for now (Local only)
        $profiles = [
            ['rec_id' => 1, 'name' => 'Lokální úložiště', 'type' => 'local', 'is_default' => true]
        ];
        echo json_encode(['success' => true, 'data' => $profiles]);
        exit;
    }
    
    // ... rest of actions omitted for brevity in this debug step ...
    echo "DEBUG: Unknown action end reached.\n";

} catch (Exception $e) {
    echo "DEBUG: EXCEPTION: " . $e->getMessage();
}
