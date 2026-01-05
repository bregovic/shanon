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
$userId = $_SESSION['user']['rec_id'] ?? null;

try {
    $pdo = DB::connect();
    
    // ===== LIST DOCUMENTS =====
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
        exit;
    }

    // ===== LIST DOCUMENT TYPES =====
    if ($action === 'types') {
        $sql = "SELECT rec_id, name, code FROM dms_doc_types WHERE is_active = true ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $types = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode(['success' => true, 'data' => $types]);
        exit;
    }

    // ===== UPLOAD DOCUMENT =====
    if ($action === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        // Validate file
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('Soubor nebyl nahrán správně.');
        }

        $file = $_FILES['file'];
        $maxSize = 10 * 1024 * 1024; // 10 MB

        if ($file['size'] > $maxSize) {
            throw new Exception('Soubor je příliš velký (max 10 MB).');
        }

        // Extract file info
        $originalName = $file['name'];
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $mimeType = $file['type'];
        $fileSize = $file['size'];

        // Allowed extensions
        $allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'txt'];
        if (!in_array($extension, $allowed)) {
            throw new Exception('Nepodporovaný typ souboru.');
        }

        // Get form data
        $displayName = $_POST['display_name'] ?? pathinfo($originalName, PATHINFO_FILENAME);
        $docTypeId = !empty($_POST['doc_type_id']) ? (int)$_POST['doc_type_id'] : null;
        $enableOcr = ($_POST['enable_ocr'] ?? '0') === '1';

        // Create unique filename
        $uniqueName = uniqid('doc_') . '_' . time() . '.' . $extension;

        // Upload directory (create if not exists)
        $uploadDir = __DIR__ . '/uploads/dms/';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $storagePath = 'uploads/dms/' . $uniqueName;
        $fullPath = $uploadDir . $uniqueName;

        // Move file
        if (!move_uploaded_file($file['tmp_name'], $fullPath)) {
            throw new Exception('Nepodařilo se uložit soubor.');
        }

        // Get tenant ID (placeholder - using fixed UUID for now)
        $tenantId = '00000000-0000-0000-0000-000000000001';

        // Insert into database
        $sql = "INSERT INTO dms_documents 
                (tenant_id, display_name, original_filename, file_extension, file_size_bytes, mime_type, 
                 doc_type_id, storage_profile_id, storage_path, ocr_status, created_by)
                VALUES 
                (:tenant_id, :display_name, :original_filename, :extension, :file_size, :mime_type,
                 :doc_type_id, 1, :storage_path, :ocr_status, :created_by)
                RETURNING rec_id";

        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tenant_id' => $tenantId,
            ':display_name' => $displayName,
            ':original_filename' => $originalName,
            ':extension' => $extension,
            ':file_size' => $fileSize,
            ':mime_type' => $mimeType,
            ':doc_type_id' => $docTypeId,
            ':storage_path' => $storagePath,
            ':ocr_status' => $enableOcr ? 'pending' : 'skipped',
            ':created_by' => $userId
        ]);

        $newId = $stmt->fetchColumn();

        echo json_encode([
            'success' => true,
            'message' => 'Dokument byl úspěšně nahrán.',
            'doc_id' => $newId
        ]);
        exit;
    }


    // =============================================
    // SETUP ENDPOINTS
    // =============================================

    // ===== NUMBER SERIES: LIST =====
    if ($action === 'number_series') {
        $sql = "SELECT * FROM dms_number_series WHERE tenant_id = :tid ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':tid' => '00000000-0000-0000-0000-000000000001']);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // ===== NUMBER SERIES: CREATE =====
    if ($action === 'number_series_create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        
        $sql = "INSERT INTO dms_number_series 
                (tenant_id, code, name, prefix, suffix, number_length, is_default, is_active, created_by)
                VALUES (:tid, :code, :name, :prefix, :suffix, :len, :def, true, :by)
                RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => '00000000-0000-0000-0000-000000000001',
            ':code' => strtoupper($input['code'] ?? 'NEW'),
            ':name' => $input['name'] ?? 'Nová řada',
            ':prefix' => $input['prefix'] ?? '',
            ':suffix' => $input['suffix'] ?? '',
            ':len' => (int)($input['number_length'] ?? 5),
            ':def' => ($input['is_default'] ?? false) ? 'true' : 'false',
            ':by' => $userId
        ]);
        $newId = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }

    // ===== NUMBER SERIES: UPDATE =====
    if ($action === 'number_series_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        if (!$id) throw new Exception('ID is required');

        $sql = "UPDATE dms_number_series SET 
                code = :code, name = :name, prefix = :prefix, suffix = :suffix, 
                number_length = :len, is_default = :def, is_active = :active
                WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':id' => $id,
            ':code' => strtoupper($input['code'] ?? ''),
            ':name' => $input['name'] ?? '',
            ':prefix' => $input['prefix'] ?? '',
            ':suffix' => $input['suffix'] ?? '',
            ':len' => (int)($input['number_length'] ?? 5),
            ':def' => ($input['is_default'] ?? false) ? 'true' : 'false',
            ':active' => ($input['is_active'] ?? true) ? 'true' : 'false'
        ]);
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== DOC TYPES: LIST (extended) =====
    if ($action === 'doc_types') {
        $sql = "SELECT dt.*, ns.name as number_series_name 
                FROM dms_doc_types dt
                LEFT JOIN dms_number_series ns ON dt.number_series_id = ns.rec_id
                ORDER BY dt.name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // ===== DOC TYPES: CREATE =====
    if ($action === 'doc_type_create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        
        $sql = "INSERT INTO dms_doc_types 
                (tenant_id, code, name, description, number_series_id, is_active)
                VALUES (:tid, :code, :name, :desc, :ns_id, true)
                RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => '00000000-0000-0000-0000-000000000001',
            ':code' => strtoupper($input['code'] ?? 'NEW'),
            ':name' => $input['name'] ?? 'Nový typ',
            ':desc' => $input['description'] ?? '',
            ':ns_id' => !empty($input['number_series_id']) ? (int)$input['number_series_id'] : null
        ]);
        $newId = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }

    // ===== DOC TYPES: UPDATE =====
    if ($action === 'doc_type_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        if (!$id) throw new Exception('ID is required');

        $sql = "UPDATE dms_doc_types SET 
                code = :code, name = :name, description = :desc, 
                number_series_id = :ns_id, is_active = :active
                WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':id' => $id,
            ':code' => strtoupper($input['code'] ?? ''),
            ':name' => $input['name'] ?? '',
            ':desc' => $input['description'] ?? '',
            ':ns_id' => !empty($input['number_series_id']) ? (int)$input['number_series_id'] : null,
            ':active' => ($input['is_active'] ?? true) ? 'true' : 'false'
        ]);
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ATTRIBUTES: LIST =====
    if ($action === 'attributes') {
        $sql = "SELECT * FROM dms_attributes WHERE tenant_id = :tid ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':tid' => '00000000-0000-0000-0000-000000000001']);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // ===== ATTRIBUTES: CREATE =====
    if ($action === 'attribute_create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        
        $sql = "INSERT INTO dms_attributes 
                (tenant_id, name, data_type, is_required, is_searchable, default_value, help_text)
                VALUES (:tid, :name, :type, :req, :search, :default, :help)
                RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => '00000000-0000-0000-0000-000000000001',
            ':name' => $input['name'] ?? 'Nový atribut',
            ':type' => $input['data_type'] ?? 'text',
            ':req' => ($input['is_required'] ?? false) ? 'true' : 'false',
            ':search' => ($input['is_searchable'] ?? true) ? 'true' : 'false',
            ':default' => $input['default_value'] ?? '',
            ':help' => $input['help_text'] ?? ''
        ]);
        $newId = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }

    // ===== ATTRIBUTES: UPDATE =====
    if ($action === 'attribute_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        if (!$id) throw new Exception('ID is required');

        $sql = "UPDATE dms_attributes SET 
                name = :name, data_type = :type, is_required = :req, 
                is_searchable = :search, default_value = :default, help_text = :help
                WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':id' => $id,
            ':name' => $input['name'] ?? '',
            ':type' => $input['data_type'] ?? 'text',
            ':req' => ($input['is_required'] ?? false) ? 'true' : 'false',
            ':search' => ($input['is_searchable'] ?? true) ? 'true' : 'false',
            ':default' => $input['default_value'] ?? '',
            ':help' => $input['help_text'] ?? ''
        ]);
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== STORAGE PROFILES: LIST =====
    if ($action === 'storage_profiles') {
        $sql = "SELECT * FROM dms_storage_profiles WHERE tenant_id = :tid ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':tid' => '00000000-0000-0000-0000-000000000001']);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // ===== STORAGE PROFILES: CREATE =====
    if ($action === 'storage_profile_create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        
        $sql = "INSERT INTO dms_storage_profiles 
                (tenant_id, name, storage_type, connection_string, base_path, is_default, is_active)
                VALUES (:tid, :name, :type, :conn, :path, :def, true)
                RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => '00000000-0000-0000-0000-000000000001',
            ':name' => $input['name'] ?? 'Nové úložiště',
            ':type' => $input['storage_type'] ?? 'local',
            ':conn' => $input['connection_string'] ?? '',
            ':path' => $input['base_path'] ?? '',
            ':def' => ($input['is_default'] ?? false) ? 'true' : 'false'
        ]);
        $newId = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }

    // ===== STORAGE PROFILES: UPDATE =====
    if ($action === 'storage_profile_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        if (!$id) throw new Exception('ID is required');

        $sql = "UPDATE dms_storage_profiles SET 
                name = :name, storage_type = :type, connection_string = :conn, 
                base_path = :path, is_default = :def, is_active = :active
                WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':id' => $id,
            ':name' => $input['name'] ?? '',
            ':type' => $input['storage_type'] ?? 'local',
            ':conn' => $input['connection_string'] ?? '',
            ':path' => $input['base_path'] ?? '',
            ':def' => ($input['is_default'] ?? false) ? 'true' : 'false',
            ':active' => ($input['is_active'] ?? true) ? 'true' : 'false'
        ]);
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== DOWNLOAD/VIEW DOCUMENT =====
    if ($action === 'download' || $action === 'view') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) {
            http_response_code(400);
            exit('ID required');
        }

        $stmt = $pdo->prepare("SELECT * FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) {
            http_response_code(404);
            exit('Dokument nenalezen');
        }

        // Resolve path (basic implementation for local storage)
        // If path starts with uploads/, prepend __DIR__
        $filepath = $doc['storage_path'];
        if (!file_exists($filepath)) {
            $filepath = __DIR__ . '/' . $filepath;
        }

        if (!file_exists($filepath)) {
            http_response_code(404);
            exit('Soubor na disku neexistuje: ' . $filepath); // Debug info (remove in prod?)
        }

        // Headers
        header('Content-Description: File Transfer');
        header('Content-Type: ' . ($doc['mime_type'] ?: 'application/octet-stream'));
        
        $disposition = ($action === 'view') ? 'inline' : 'attachment';
        header('Content-Disposition: ' . $disposition . '; filename="' . rawurlencode($doc['original_filename']) . '"');
        
        header('Content-Length: ' . filesize($filepath));
        readfile($filepath);
        exit;
    }

    // ===== UNKNOWN ACTION =====
    echo json_encode(['success' => false, 'error' => 'Unknown action']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
