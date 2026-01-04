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

    // ===== UNKNOWN ACTION =====
    echo json_encode(['success' => false, 'error' => 'Unknown action']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
