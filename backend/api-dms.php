<?php
// backend/api-dms.php
// Shanon DMS API - Reconstructed & Cleaned
error_reporting(E_ALL);
ini_set('display_errors', 0); // JSON response expected
ini_set('log_errors', 1);

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';
require_once 'helpers/OcrEngine.php';

header("Content-Type: application/json");

$action = $_GET['action'] ?? 'list';

// Auth Check (Skip for debug_setup if needed, currently restricted)
if (!isset($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = $_SESSION['user']['rec_id'] ?? null;
$tenantId = $_SESSION['user']['tenant_id'] ?? '00000000-0000-0000-0000-000000000001';

try {
    $pdo = DB::connect();

    // -------------------------------------------------------------------------
    // ACTION: LIST
    // -------------------------------------------------------------------------
    if ($action === 'list') {
        // Ensure 'status' column is selected if it exists (it does now)
        $sql = "SELECT d.*, t.name as doc_type_name, u.full_name as uploaded_by_name
                FROM dms_documents d
                LEFT JOIN dms_doc_types t ON d.doc_type_id = t.rec_id
                LEFT JOIN sys_users u ON d.created_by = u.rec_id
                ORDER BY d.created_at DESC LIMIT 100";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $docs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Fix JSON UTF-8
        $json = json_encode(['success' => true, 'data' => $docs], JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) throw new Exception(json_last_error_msg());
        echo $json;
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: DOC TYPES
    // -------------------------------------------------------------------------
    if ($action === 'types' || $action === 'doc_types') {
        $stmt = $pdo->prepare("SELECT * FROM dms_doc_types WHERE is_active = true ORDER BY name");
        $stmt->execute();
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: STORAGE PROFILES
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // ACTION: STORAGE PROFILES
    // -------------------------------------------------------------------------
    if ($action === 'storage_profiles') {
        $stmt = $pdo->prepare("SELECT * FROM dms_storage_profiles ORDER BY rec_id");
        $stmt->execute();
        $profiles = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Decode configuration JSON for frontend
        foreach ($profiles as &$p) {
            $p['configuration'] = json_decode($p['configuration'] ?? '{}', true);
        }
        
        echo json_encode(['success' => true, 'data' => $profiles]);
        exit;
    }

    if ($action === 'storage_profile_update') {
        $input = json_decode(file_get_contents('php://input'), true);
        
        $id = $input['rec_id'] ?? $input['id'] ?? null;
        $name = $input['name'] ?? 'New Profile';
        $type = $input['type'] ?? 'local';
        $config = json_encode($input['configuration'] ?? $input['config'] ?? [], JSON_INVALID_UTF8_SUBSTITUTE);
        $isActive = filter_var($input['is_active'] ?? true, FILTER_VALIDATE_BOOLEAN);
        $isDefault = filter_var($input['is_default'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if ($isDefault) {
            // Unset other defaults
            $pdo->exec("UPDATE dms_storage_profiles SET is_default = false");
        }

        if ($id) {
            $sql = "UPDATE dms_storage_profiles SET name=:name, configuration=:config, is_active=:active, is_default=:def WHERE rec_id=:id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':name'=>$name, ':config'=>$config, ':active'=>$isActive? 'true':'false', ':def'=>$isDefault?'true':'false', ':id'=>$id]);
        } else {
            $sql = "INSERT INTO dms_storage_profiles (name, type, configuration, is_active, is_default) VALUES (:name, :type, :config, :active, :def)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':name'=>$name, ':type'=>$type, ':config'=>$config, ':active'=>$isActive?'true':'false', ':def'=>$isDefault?'true':'false']);
        }
        
        echo json_encode(['success' => true]);
        exit;
    }

    if ($action === 'storage_profile_delete') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['id'] ?? null;
        
        if (!$id) throw new Exception("ID required");

        // Protect system profiles if needed, or rely on UI warning.
        
        $stmt = $pdo->prepare("DELETE FROM dms_storage_profiles WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        
        echo json_encode(['success' => true]);
        exit;
    }

    if ($action === 'storage_profile_test') {
        $input = json_decode(file_get_contents('php://input'), true);
        
        $type = $input['type'] ?? 'local';
        $config = $input['configuration'] ?? $input['config'] ?? [];
        
        // Ensure config is array
        if (is_string($config)) {
             $config = json_decode($config, true);
        }

        if ($type === 'google_drive') {
            require_once 'helpers/GoogleDriveStorage.php';
            try {
                $folderId = $config['folder_id'] ?? '';
                $creds = $config['service_account_json'] ?? ''; 
                
                // If creds is array, json_encode it back for the constructor
                if (is_array($creds)) {
                    $creds = json_encode($creds);
                }
                
                $drive = new GoogleDriveStorage($creds, $folderId);
                $result = $drive->testConnection();
                
                echo json_encode($result);
            } catch (Exception $e) {
                echo json_encode(['success' => false, 'error' => $e->getMessage()]);
            }
        } elseif ($type === 'local') {
             // Simple check for local
             $uploadDir = __DIR__ . '/../uploads/dms';
             if (is_writable($uploadDir)) {
                echo json_encode(['success' => true, 'message' => 'Lokální úložiště je dostupné a zapisovatelné.']);
             } else {
                echo json_encode(['success' => false, 'error' => 'Adresář uploads/dms není zapisovatelný.']);
             }
        } else {
             echo json_encode(['success' => false, 'error' => 'Unknown storage type']);
        }
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: ATTRIBUTES (For Type)
    // -------------------------------------------------------------------------
    if ($action === 'attributes') {
        $typeId = $_GET['type_id'] ?? null;
        if (!$typeId) {
            // Return all attributes if no type specified ? Or just common?
            // Let's return all.
            $stmt = $pdo->prepare("SELECT * FROM dms_attributes WHERE tenant_id = :tid OR tenant_id IS NULL ORDER BY name");
            $stmt->execute([':tid' => $tenantId]);
        } else {
            // Get attributes linked to this type + mapped flags
            // Note: If linking table doesn't exist yet, fallback to all.
            // Assumption: dms_doc_type_attributes exists (Migration 030)
            $sql = "SELECT a.*, dta.is_required, dta.is_visible 
                    FROM dms_attributes a
                    JOIN dms_doc_type_attributes dta ON a.rec_id = dta.attribute_id
                    WHERE dta.doc_type_id = :dtid AND (a.tenant_id = :tid OR a.tenant_id IS NULL)
                    ORDER BY a.name";
             $stmt = $pdo->prepare($sql);
             $stmt->execute([':dtid' => $typeId, ':tid' => $tenantId]);
        }
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: UPDATE (Metadata / Status)
    // -------------------------------------------------------------------------
    if ($action === 'update' || $action === 'update_metadata') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || !isset($input['id'])) throw new Exception("Invalid input");

        $docId = $input['id'];
        $fields = [];
        $params = [':id' => $docId];

        if (isset($input['status'])) {
            $fields[] = "status = :status";
            $params[':status'] = $input['status'];
        }
        if (isset($input['doc_type_id'])) {
            $fields[] = "doc_type_id = :dtid";
            $params[':dtid'] = $input['doc_type_id'];
        }
        // Save attributes into metadata JSON
        if (isset($input['attributes'])) {
            // Fetch existing metadata first to merge? Or just overwrite 'attributes' key?
            // Let's do a smart merge via SQL if possible, or fetch-update.
            // Simple fetch-update:
            $stmt = $pdo->prepare("SELECT metadata FROM dms_documents WHERE rec_id = :id");
            $stmt->execute([':id' => $docId]);
            $currentMeta = json_decode($stmt->fetchColumn() ?: '{}', true);
            $currentMeta['attributes'] = $input['attributes']; // Update attributes
            
            $fields[] = "metadata = :meta";
            $params[':meta'] = json_encode($currentMeta, JSON_INVALID_UTF8_SUBSTITUTE);
        }

        if (empty($fields)) {
            echo json_encode(['success' => true, 'message' => 'No changes']);
            exit;
        }

        $sql = "UPDATE dms_documents SET " . implode(', ', $fields) . ", updated_at = NOW() WHERE rec_id = :id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        echo json_encode(['success' => true]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: UPLOAD
    // -------------------------------------------------------------------------
    if ($action === 'upload') {
        if (empty($_FILES['file'])) throw new Exception("No file uploaded");
        
        $file = $_FILES['file'];
        $docTypeId = $_POST['doc_type_id'] ?? null;
        $displayName = $_POST['display_name'] ?? $file['name'];
        $autoOcr = filter_var($_POST['auto_ocr'] ?? false, FILTER_VALIDATE_BOOLEAN);

        // Upload Dir
        $baseDir = dirname(__DIR__); // Root of project
        $uploadDir = $baseDir . '/uploads/dms';
        
        // Ensure directory exists
        if (!is_dir($uploadDir)) {
            // Try to create recursively
            if (!@mkdir($uploadDir, 0777, true)) {
                $err = error_get_last();
                throw new Exception("Failed to create upload directory '$uploadDir'. Error: " . ($err['message'] ?? 'Unknown'));
            }
        }
        
        // Ensure writable
        if (!is_writable($uploadDir)) {
            // Try to fix permissions
            @chmod($uploadDir, 0777);
            if (!is_writable($uploadDir)) {
                 throw new Exception("Upload directory '$uploadDir' is not writable.");
            }
        }

        // Generate Filename
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        // Sanitize filename for storage (avoid utf8 issues on filesystem)
        $storageName = uniqid() . '.' . $ext;
        $targetPath = $uploadDir . '/' . $storageName;
        $relPath = 'uploads/dms/' . $storageName; // Relative for DB

        if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
            $err = error_get_last();
            // Provide detail: Source -> Target
            throw new Exception("Failed to move uploaded file from '{$file['tmp_name']}' to '$targetPath'. PHP Error: " . ($err['message'] ?? 'None'));
        }

        // DB Insert
        $sql = "INSERT INTO dms_documents (tenant_id, display_name, original_filename, file_extension, file_size_bytes, mime_type, doc_type_id, storage_path, created_by, status)
                VALUES (:tid, :dname, :oname, :ext, :size, :mime, :dtid, :path, :uid, 'new')
                RETURNING rec_id";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => $tenantId,
            ':dname' => $displayName,
            ':oname' => $file['name'],
            ':ext' => $ext,
            ':size' => $file['size'],
            ':mime' => $file['type'],
            ':dtid' => $docTypeId ?: null, // Can be null initially
            ':path' => $relPath,
            ':uid' => $userId
        ]);
        
        $newId = $stmt->fetchColumn();

        // Trigger OCR?
        if ($autoOcr && $newId) {
             $ocr = new OcrEngine($pdo, $tenantId);
             try {
                 $ocrResult = $ocr->analyzeDocument($newId);
                 // Update doc with results
                 $meta = ['attributes' => []];
                 foreach ($ocrResult['attributes'] as $attr) {
                     $meta['attributes'][$attr['attribute_code']] = $attr['found_value'];
                 }
                 
                 // Update DB
                 $upd = $pdo->prepare("UPDATE dms_documents SET ocr_status = 'completed', status = 'review', metadata = :meta, ocr_text_content = :txt WHERE rec_id = :id");
                 $upd->execute([
                     ':meta' => json_encode($meta, JSON_INVALID_UTF8_SUBSTITUTE),
                     ':txt' => $ocrResult['raw_text_preview'],
                     ':id' => $newId
                 ]);
             } catch (Exception $e) {
                 // Log OCR error check but don't fail upload
                 error_log("AutoOCR Failed: " . $e->getMessage());
                 $pdo->exec("UPDATE dms_documents SET ocr_status = 'failed' WHERE rec_id = $newId");
             }
        }

        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }
    
    // -------------------------------------------------------------------------
    // ACTION: DELETE
    // -------------------------------------------------------------------------
    if ($action === 'delete') {
         $input = json_decode(file_get_contents('php://input'), true);
         $ids = $input['ids'] ?? [];
         if (empty($ids)) throw new Exception("No IDs provided");

         // Convert to ints
         $ids = array_map('intval', $ids);
         $inQuery = implode(',', $ids);

         // Delete files? (Ideally yes, but let's keep it simple for now and just soft delete or delete DB record)
         // To properly delete files we need to fetch paths first.
         $stmt = $pdo->query("SELECT storage_path FROM dms_documents WHERE rec_id IN ($inQuery)");
         while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
             $p = __DIR__ . '/../' . $row['storage_path'];
             if (file_exists($p)) @unlink($p);
         }

         $pdo->exec("DELETE FROM dms_documents WHERE rec_id IN ($inQuery)");
         echo json_encode(['success' => true]);
         exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: ANALYZE (Manual OCR Trigger)
    // -------------------------------------------------------------------------
    if ($action === 'analyze' || $action === 'analyze_doc') {
        $input = json_decode(file_get_contents('php://input'), true);
        $ids = $input['ids'] ?? [];
        if (empty($ids)) throw new Exception("No IDs provided");
        
        $ocr = new OcrEngine($pdo, $tenantId);
        $results = [];

        foreach ($ids as $id) {
             try {
                 // Reset status
                 $pdo->exec("UPDATE dms_documents SET ocr_status = 'processing' WHERE rec_id = $id");

                 $res = $ocr->analyzeDocument($id);
                 
                 // Save
                 $meta = ['attributes' => []];
                 foreach ($res['attributes'] as $attr) {
                     $meta['attributes'][$attr['attribute_code']] = $attr['found_value'];
                 }
                 // Preserve existing metadata?
                 // Simple overwrite for OCR results usually safer to avoid stale data mixing
                 
                 $pdo->prepare("UPDATE dms_documents SET ocr_status = 'completed', status = 'review', metadata = :meta, ocr_text_content = :txt WHERE rec_id = :id")
                     ->execute([
                         ':meta' => json_encode($meta, JSON_INVALID_UTF8_SUBSTITUTE),
                         ':txt' => $res['raw_text_preview'],
                         ':id' => $id
                     ]);
                 
                 $results[$id] = 'ok';
             } catch (Exception $e) {
                 $pdo->exec("UPDATE dms_documents SET ocr_status = 'failed' WHERE rec_id = $id");
                 $results[$id] = $e->getMessage();
             }
        }
        
        echo json_encode(['success' => true, 'results' => $results]);
        exit;
    }
    
    // -------------------------------------------------------------------------
    // ACTION: VIEW RAW (For iframe)
    // -------------------------------------------------------------------------
    if ($action === 'view') {
        $id = $_GET['id'] ?? null;
        if (!$id) die("ID missing");

        $stmt = $pdo->prepare("SELECT storage_path, mime_type, original_filename FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) die("Document not found");

        $path = __DIR__ . '/../' . $doc['storage_path'];
        if (!file_exists($path)) die("File not found on server");

        header("Content-Type: " . $doc['mime_type']);
        header("Content-Disposition: inline; filename=\"" . $doc['original_filename'] . "\"");
        readfile($path);
        exit;
    }

    throw new Exception("Unknown action: $action");

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
