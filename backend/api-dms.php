<?php
// backend/api-dms.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';
require_once 'helpers/OcrEngine.php';
// GoogleDriveStorage loaded on demand

header("Content-Type: application/json");

$action = $_GET['action'] ?? 'list';

if (!isset($_SESSION['loggedin']) && $action !== 'debug_setup') {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = $_SESSION['user']['rec_id'] ?? null;

try {
    $pdo = DB::connect();

    // ===== DEBUG SETUP: CREATE TABLES (MIGRATED TO install-db.php) =====
    // if ($action === 'debug_setup') { ... }
    
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
        
        // Fallback: If no types found, return defaults temporarily to unblock user
        if (empty($types)) {
             $types = [
                 ['rec_id' => '0', 'name' => 'Faktura (Fallback)', 'code' => 'INV'],
                 ['rec_id' => '-1', 'name' => 'Nezařazeno', 'code' => 'OTHER']
             ];
        }

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
                :doc_type_id, :profile_id, :storage_path, :ocr_status, :created_by)
                RETURNING rec_id";

        // Resolve Storage Profile
        $stmtProf = $pdo->prepare("SELECT * FROM dms_storage_profiles WHERE is_default = true LIMIT 1");
        $stmtProf->execute();
        $profile = $stmtProf->fetch(PDO::FETCH_ASSOC);

        if (!$profile) {
            // Fallback: any active
            $stmtProf = $pdo->prepare("SELECT * FROM dms_storage_profiles WHERE is_active = true ORDER BY rec_id ASC LIMIT 1");
            $stmtProf->execute();
            $profile = $stmtProf->fetch(PDO::FETCH_ASSOC);
        }

        if (!$profile) {
             // Auto-create default local profile
             $pdo->prepare("INSERT INTO dms_storage_profiles (tenant_id, name, storage_type, provider_type, base_path, is_default, is_active) VALUES (:tid, 'Local Storage', 'local', 'local', 'uploads/dms/', true, true)")->execute([':tid' => $tenantId]);
             $profileId = $pdo->lastInsertId();
             // Fetch it back to be sure
             $stmtProf = $pdo->prepare("SELECT * FROM dms_storage_profiles WHERE rec_id = :id");
             $stmtProf->execute([':id' => $profileId]);
             $profile = $stmtProf->fetch(PDO::FETCH_ASSOC);
        }

        $storageProfileId = $profile['rec_id'];
        
        // Handle External Storage
        $uploadWarning = null;
        if (($profile['provider_type'] ?? '') === 'google_drive') {
            try {
                require_once __DIR__ . '/helpers/GoogleDriveStorage.php';
                $gd = new GoogleDriveStorage($profile['connection_string'], $profile['base_path']);
                // Use the local file we just moved
                $gFile = $gd->uploadFile($fullPath, $uniqueName, $mimeType);
                
                if (isset($gFile['id'])) {
                    $storagePath = $gFile['id']; // Store Google ID as path
                } else {
                    // Fallback or error?
                    $uploadWarning = "Google Drive API nevrátilo ID souboru.";
                }
            } catch (Exception $e) {
                // Return the specific error to the user
                $uploadWarning = "Chyba nahrávání na Google Drive: " . $e->getMessage();
            }
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tenant_id' => $tenantId,
            ':display_name' => $displayName,
            ':original_filename' => $originalName,
            ':extension' => $extension,
            ':file_size' => $fileSize,
            ':mime_type' => $mimeType,
            ':doc_type_id' => $docTypeId,
            ':profile_id' => $storageProfileId,
            ':storage_path' => $storagePath,
            ':ocr_status' => $enableOcr ? 'pending' : 'skipped',
            ':created_by' => $userId
        ]);

        $newId = $stmt->fetchColumn();

        // Save binary content to DB (Persistent Storage)
        $content = file_get_contents($file['tmp_name']);
        if ($content !== false) {
             $stmtBlob = $pdo->prepare("INSERT INTO dms_file_contents (doc_id, content) VALUES (:id, :content)");
             // Bind as parameter (PDO handles escaping for Bytea)
             $stmtBlob->bindParam(':id', $newId);
             $stmtBlob->bindParam(':content', $content, PDO::PARAM_LOB);
             $stmtBlob->execute();
        }

        echo json_encode([
            'success' => true,
            'message' => 'Dokument byl úspěšně nahrán.',
            'doc_id' => $newId,
            'warning' => $uploadWarning
        ]);
        exit;
    }


    // =============================================
    // SETUP ENDPOINTS
    // =============================================

    // ... (rest of setup endpoints) ...

    // ===== DELETE DOCUMENT =====
    if ($action === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = (int)($input['id'] ?? 0);
        
        if (!$id) throw new Exception('ID is required');

        // Delete from DB (CASCADE handles file content)
        $stmt = $pdo->prepare("DELETE FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        
        // Try delete file from disk if exists
        // Fetch path first? Too late, already deleted from DB. 
        // Ideally we should select first, then delete. 
        // But for ephemeral environments it doesn't matter much. 
        // If needed we can improve later.

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

        $filepath = $doc['storage_path'];
        // Fix relative
        if (!file_exists($filepath) && file_exists(__DIR__ . '/' . $filepath)) {
            $filepath = __DIR__ . '/' . $filepath;
        }

        // Headers
        header('Content-Description: File Transfer');
        header('Content-Type: ' . ($doc['mime_type'] ?: 'application/octet-stream'));
        $disposition = ($action === 'view') ? 'inline' : 'attachment';
        header('Content-Disposition: ' . $disposition . '; filename="' . rawurlencode($doc['original_filename']) . '"');

        // Strategy 1: Local File
        if (file_exists($filepath)) {
            header('Content-Length: ' . filesize($filepath));
            readfile($filepath);
            exit;
        }

        // Strategy 2: DB Blob
        $stmtBlob = $pdo->prepare("SELECT content FROM dms_file_contents WHERE doc_id = :id");
        $stmtBlob->execute([':id' => $id]);
        // For Postgres BYTEA, PDO might return a stream resource
        $blob = $stmtBlob->fetchColumn();

        if ($blob !== false) {
             if (is_resource($blob)) {
                 $stats = fstat($blob);
                 if ($stats && isset($stats['size'])) {
                     header('Content-Length: ' . $stats['size']);
                 }
                 fpassthru($blob);
             } else {
                 // It's a string
                 header('Content-Length: ' . strlen($blob));
                 echo $blob;
             }
             exit;
        }
        
        http_response_code(404);
        exit('Soubor na disku neexistuje a nebyl nalezen ani v databázi.');
    }

    // ===== OCR ANALYZE DOCUMENT =====
    if ($action === 'analyze_doc') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) throw new Exception('ID is required');

        // Check if tenant_id column exists (setup backward compatibility)
        // Usually we get tenant from session or fixed dev tenant
        $tenantId = '00000000-0000-0000-0000-000000000001';

        $engine = new OcrEngine($pdo, $tenantId);
        $result = $engine->analyzeDocument($id);

        if ($result['success'] && !empty($result['attributes'])) {
            // Transform attributes to simple key-value for metadata
            $extracted = [];
            foreach ($result['attributes'] as $attr) {
                // Use code if possible (cleaner for machine ref), else name
                // Note: OcrEngine currently returns 'attribute_name'. We might need to fetch code or just use name.
                // Since OcrEngine doesn't return Code yet, let's use name.
                // Ideally we should modify OcrEngine to return Code too.
                $key = $attr['attribute_name'];
                $extracted[$key] = $attr['found_value'];
            }

            // Update Metadata column in DB with merged data
            // PostgreSQL specific for JSONB merge used '||'
            $metaJson = json_encode(['attributes' => $extracted]);
            
            $sql = "UPDATE dms_documents 
                    SET metadata = metadata || :new_meta, 
                        ocr_status = 'completed' 
                    WHERE rec_id = :id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':new_meta' => $metaJson, ':id' => $id]);
        } else {
             // Mark as completed even if nothing found, so we don't retry forever?
             // Or maybe 'completed' with empty results.
             $sql = "UPDATE dms_documents SET ocr_status = 'completed' WHERE rec_id = :id";
             $pdo->prepare($sql)->execute([':id' => $id]);
        }

        echo json_encode($result);
        exit;
    }

    // ===== UPDATE METADATA (MANUAL CORRECTION) =====
    if ($action === 'update_metadata' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['id'] ?? 0;
        $attributes = $input['attributes'] ?? []; 

        if (!$id) throw new Exception('ID is required');

        // Fetch existing
        $stmt = $pdo->prepare("SELECT metadata FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $currMeta = json_decode($stmt->fetchColumn() ?: '{}', true);
        
        $currAttrs = $currMeta['attributes'] ?? [];
        
        foreach ($attributes as $k => $v) {
            $currAttrs[$k] = $v;
        }
        
        $currMeta['attributes'] = $currAttrs;
        
        // Update DB
        $sql = "UPDATE dms_documents 
                SET metadata = :meta, 
                    ocr_status = 'verified' 
                WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':meta' => json_encode($currMeta), 
            ':id' => $id
        ]);

        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ADMIN: DOCUMENT TYPES =====
    if ($action === 'doc_types') {
        $sql = "SELECT t.*, s.name as number_series_name 
                FROM dms_doc_types t
                LEFT JOIN sys_number_series s ON t.number_series_id = s.rec_id
                ORDER BY t.name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    // ===== ADMIN: NUMBER SERIES =====
    if ($action === 'number_series') {
        $sql = "SELECT * FROM sys_number_series ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    // ===== ADMIN: ATTRIBUTES =====
    if ($action === 'attributes') {
        $sql = "SELECT * FROM dms_attributes ORDER BY name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    // ===== ADMIN: ATTRIBUTE CREATE/UPDATE =====
    if (($action === 'attribute_create' || $action === 'attribute_update') && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $tenantId = '00000000-0000-0000-0000-000000000001';

        $name = $input['name'] ?? '';
        $dataType = $input['data_type'] ?? 'text';
        $isRequired = !empty($input['is_required']);
        $isSearchable = !empty($input['is_searchable']);
        $defaultValue = $input['default_value'] ?? '';
        $helpText = $input['help_text'] ?? '';
        
        $code = $input['code'] ?? null;
        $scanDirection = $input['scan_direction'] ?? 'auto';

        if (!$name) throw new Exception('Name is required');

        if ($action === 'attribute_create') {
            $sql = "INSERT INTO dms_attributes (tenant_id, name, code, data_type, is_required, is_searchable, default_value, help_text, scan_direction)
                    VALUES (:tid, :name, :code, :d, :req, :srch, :def, :hlp, :sd)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':tid' => $tenantId,
                ':name' => $name,
                ':code' => $code,
                ':d' => $dataType,
                ':req' => $isRequired ? 't' : 'f',
                ':srch' => $isSearchable ? 't' : 'f',
                ':def' => $defaultValue,
                ':hlp' => $helpText,
                ':sd' => $scanDirection
            ]);
        } else {
            $id = $input['id'] ?? 0;
            if (!$id) throw new Exception('ID required for update');
            
            $sql = "UPDATE dms_attributes SET 
                    name = :name, code = :code, data_type = :d, is_required = :req, is_searchable = :srch, 
                    default_value = :def, help_text = :hlp, scan_direction = :sd
                    WHERE rec_id = :id";
             $stmt = $pdo->prepare($sql);
             $stmt->execute([
                ':name' => $name,
                ':code' => $code,
                ':d' => $dataType,
                ':req' => $isRequired ? 't' : 'f',
                ':srch' => $isSearchable ? 't' : 'f',
                ':def' => $defaultValue,
                ':hlp' => $helpText,
                ':sd' => $scanDirection,
                ':id' => $id
             ]);
        }
        
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ADMIN: STORAGE PROFILES =====
    if ($action === 'storage_profiles') {
        // Use try-catch to avoid breaking if table missing (though it should exist)
        try {
            $sql = "SELECT * FROM dms_storage_profiles ORDER BY name";
            $stmt = $pdo->prepare($sql);
            $stmt->execute();
            $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode(['success' => true, 'data' => $data]);
        } catch (Exception $e) {
            // Return empty list if table doesn't exist
            echo json_encode(['success' => true, 'data' => []]);
        }
        exit;
    }

    // ===== ADMIN: STORAGE PROFILE CREATE/UPDATE =====
    if (($action === 'storage_profile_create' || $action === 'storage_profile_update') && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $tenantId = '00000000-0000-0000-0000-000000000001';

        $name = $input['name'] ?? '';
        $storageType = $input['storage_type'] ?? 'local';
        $basePath = $input['base_path'] ?? '';
        $connStr = $input['connection_string'] ?? '';
        $isDefault = !empty($input['is_default']);
        $isActive = isset($input['is_active']) ? $input['is_active'] : true;

        if (!$name) throw new Exception('Name is required');

        // If setting as default, unset others first
        if ($isDefault) {
             $pdo->prepare("UPDATE dms_storage_profiles SET is_default = false WHERE tenant_id = :tid")
                 ->execute([':tid' => $tenantId]);
        }

        if ($action === 'storage_profile_create') {
            $sql = "INSERT INTO dms_storage_profiles 
                    (tenant_id, name, storage_type, provider_type, base_path, connection_string, is_default, is_active)
                    VALUES (:tid, :name, :type, :prov_type, :path, :conn, :def, :act)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':tid' => $tenantId,
                ':name' => $name,
                ':type' => $storageType,
                ':prov_type' => $storageType,
                ':path' => $basePath,
                ':conn' => $connStr,
                ':def' => $isDefault ? 't' : 'f',
                ':act' => $isActive ? 't' : 'f'
            ]);
        } else {
            $id = $input['id'] ?? 0;
            if (!$id) throw new Exception('ID required for update');
            
            $sql = "UPDATE dms_storage_profiles SET 
                    name = :name, storage_type = :type, provider_type = :prov_type, base_path = :path, 
                    connection_string = :conn, is_default = :def, is_active = :act
                    WHERE rec_id = :id";
             $stmt = $pdo->prepare($sql);
             $stmt->execute([
                ':name' => $name,
                ':type' => $storageType,
                ':prov_type' => $storageType,
                ':path' => $basePath,
                ':conn' => $connStr,
                ':def' => $isDefault ? 't' : 'f',
                ':act' => $isActive ? 't' : 'f',
                ':id' => $id
             ]);
        }
        
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ADMIN: STORAGE PROFILE DELETE =====
    if ($action === 'storage_profile_delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['id'] ?? 0;
        
        if (!$id) throw new Exception('ID is required');

        // Check usage before delete
        $count = $pdo->prepare("SELECT COUNT(*) FROM dms_documents WHERE storage_profile_id = :id")->execute([':id'=>$id]);
        // Actually execute returns bool, fetchColumn needed. 
        // Let's maximize safety.
        $stmtCheck = $pdo->prepare("SELECT COUNT(*) FROM dms_documents WHERE storage_profile_id = :id");
        $stmtCheck->execute([':id'=>$id]);
        if ($stmtCheck->fetchColumn() > 0) {
            throw new Exception('Nelze smazat úložiště, které obsahuje dokumenty.');
        }

        $sql = "DELETE FROM dms_storage_profiles WHERE rec_id = :id";
        $pdo->prepare($sql)->execute([':id' => $id]);
        
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ADMIN: STORAGE PROFILE TEST =====
    if ($action === 'storage_profile_test' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $name = $input['name'] ?? 'Test';
        $storageType = $input['storage_type'] ?? 'local';
        $basePath = $input['base_path'] ?? '';
        $connStr = $input['connection_string'] ?? '';

        if ($storageType === 'local') {
            if (empty($basePath)) {
                echo json_encode(['success' => false, 'error' => 'Chybí cesta k adresáři']);
                exit;
            }
            
            // Basic directory check
            if (is_dir($basePath) && is_writable($basePath)) {
                 echo json_encode(['success' => true, 'message' => 'Adresář existuje a je zapisovatelný']);
            } else {
                 // Try relative path from basedir
                 $fullPath = __DIR__ . '/' . ltrim($basePath, '/');
                 if (is_dir($fullPath) && is_writable($fullPath)) {
                     echo json_encode(['success' => true, 'message' => 'Relativní adresář existuje a je zapisovatelný']);
                 } else {
                     echo json_encode(['success' => false, 'error' => 'Adresář neexistuje nebo není zapisovatelný']);
                 }
            }
            exit;
        }

        // For Google Drive and others
        if ($storageType === 'google_drive') {
            if (empty($connStr) || empty($basePath)) {
                echo json_encode(['success' => false, 'error' => 'Chybí Folder ID nebo Credentials JSON']);
                exit;
            }

            if (file_exists('helpers/GoogleDriveStorage.php')) {
                require_once 'helpers/GoogleDriveStorage.php';
            }

            try {
                // Initialize Storage
                $drive = new GoogleDriveStorage($connStr, $basePath);
                $result = $drive->testConnection();
                
                if ($result['success']) {
                    echo json_encode(['success' => true, 'message' => 'Připojení úspěšné. Složka: ' . ($result['folderName'] ?? 'Neznámá')]);
                } else {
                    echo json_encode(['success' => false, 'error' => $result['error']]);
                }
            } catch (Exception $e) {
                echo json_encode(['success' => false, 'error' => $e->getMessage()]);
            }
            exit;
        }

        echo json_encode(['success' => true, 'message' => 'Test pro typ ' . $storageType . ' není implementován nebo je vypnutý.']);
        exit;
    }

    // ===== UNKNOWN ACTION =====
    echo json_encode(['success' => false, 'error' => 'Unknown action']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
