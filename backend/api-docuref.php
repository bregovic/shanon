<?php
// backend/api-docuref.php
// Generic Document Reference System (D365 Style)

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// --- UTILS ---
function returnJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// --- AUTH ---
if (!isset($_SESSION['loggedin']) || !isset($_SESSION['user'])) {
    // For dev/testing if needed, but safer to block
    returnJson(['error' => 'Unauthorized'], 401);
}
$userId = $_SESSION['user']['id'] ?? $_SESSION['user_id'] ?? null;
$tenantId = '00000000-0000-0000-0000-000000000001'; // TODO: Context

try {
    $pdo = DB::connect();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    // === LIST ===
    if ($action === 'list' && $method === 'GET') {
        $refTable = $_GET['ref_table'] ?? null;
        $refId = $_GET['ref_id'] ?? null;

        if (!$refTable || !$refId) returnJson(['error' => 'Missing refs'], 400);

        $stmt = $pdo->prepare("
            SELECT rec_id as id, type, name, notes, file_mime, file_size, storage_type, created_at, created_by,
                   (SELECT full_name FROM sys_users WHERE rec_id = sys_docuref.created_by) as creator_name
            FROM sys_docuref 
            WHERE ref_table = ? AND ref_id = ?
            ORDER BY created_at DESC
        ");
        $stmt->execute([$refTable, $refId]);
        returnJson(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // === CREATE (Upload/Note) ===
    if ($action === 'create' && $method === 'POST') {
        $refTable = $_POST['ref_table'] ?? null;
        $refId = $_POST['ref_id'] ?? null;
        $type = $_POST['type'] ?? 'Note'; // 'File', 'Note', 'URL'
        $name = $_POST['name'] ?? 'Attachment';
        $notes = $_POST['notes'] ?? null;
        
        if (!$refTable || !$refId) returnJson(['error' => 'Missing refs'], 400);

        // Get Storage Path from Params
        $pathParams = $pdo->prepare("SELECT param_value FROM sys_parameters WHERE param_key = 'DOCUREF_STORAGE_PATH'");
        $pathParams->execute();
        $baseDir = $pathParams->fetchColumn() ?: 'uploads/docuref';
        
        // Ensure dir exists
        $targetDir = __DIR__ . '/../' . $baseDir;
        if (!file_exists($targetDir)) mkdir($targetDir, 0777, true);

        $filePath = null;
        $fileMime = null;
        $fileSize = 0;
        $storageType = 'local';

        if ($type === 'File' && isset($_FILES['file'])) {
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) returnJson(['error' => 'Upload failed'], 400);
            
            $fileMime = $f['type'];
            $fileSize = $f['size'];
            $ext = pathinfo($f['name'], PATHINFO_EXTENSION);
            $cleanName = pathinfo($f['name'], PATHINFO_FILENAME); // simplify?
            // Generate unique name
            $storedName = $refTable . '_' . $refId . '_' . uniqid() . '.' . $ext;
            $fullPath = $targetDir . '/' . $storedName;
            
            if (move_uploaded_file($f['tmp_name'], $fullPath)) {
                $filePath = $baseDir . '/' . $storedName;
                if (!$name || $name === 'Attachment') $name = $f['name'];
            } else {
                returnJson(['error' => 'Failed to save file'], 500);
            }
        }

        $stmt = $pdo->prepare("
            INSERT INTO sys_docuref (ref_table, ref_id, type, name, notes, file_path, file_mime, file_size, storage_type, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING rec_id
        ");
        $stmt->execute([$refTable, $refId, $type, $name, $notes, $filePath, $fileMime, $fileSize, $storageType, $userId]);
        $newId = $stmt->fetchColumn();
        
        returnJson(['success' => true, 'id' => $newId]);
    }

    // === DELETE ===
    if ($action === 'delete' && $method === 'POST') {
        $id = $_POST['id'] ?? null;
        if (!$id) returnJson(['error' => 'Missing ID'], 400);

        // Get file info first to delete physical file
        $stmt = $pdo->prepare("SELECT file_path, storage_type, created_by FROM sys_docuref WHERE rec_id = ?");
        $stmt->execute([$id]);
        $item = $stmt->fetch();

        if (!$item) returnJson(['error' => 'Not found'], 404);

        // Permission check: Owner or Admin
        // if ($item['created_by'] != $userId) ... TODO

        if ($item['file_path'] && $item['storage_type'] === 'local') {
             $absPath = __DIR__ . '/../' . $item['file_path'];
             if (file_exists($absPath)) unlink($absPath);
        }

        $del = $pdo->prepare("DELETE FROM sys_docuref WHERE rec_id = ?");
        $del->execute([$id]);

        returnJson(['success' => true]);
    }
    
    // === DOWNLOAD ===
    if ($action === 'download' && $method === 'GET') {
        $id = $_GET['id'] ?? null;
        if (!$id) returnJson(['error' => 'ID missing'], 400);
        
        $stmt = $pdo->prepare("SELECT * FROM sys_docuref WHERE rec_id = ?");
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        
        if (!$item || !$item['file_path']) returnJson(['error' => 'Not found or no file'], 404);
        
        $absPath = __DIR__ . '/../' . $item['file_path'];
        if (!file_exists($absPath)) returnJson(['error' => 'File missing on server'], 404);
        
        header('Content-Type: ' . ($item['file_mime'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . $item['name'] . '"');
        header('Content-Length: ' . filesize($absPath));
        readfile($absPath);
        exit;
    }

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => $e->getMessage()], 500);
}
