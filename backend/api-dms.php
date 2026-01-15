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
        $type = $input['type'] ?? $input['storage_type'] ?? 'local';
        
        // Map legacy fields to configuration if needed
        $configData = $input['configuration'] ?? $input['config'] ?? [];
        if (empty($configData)) {
            if ($type === 'google_drive') {
                 $configData = [
                     'folder_id' => $input['base_path'] ?? '',
                     'service_account_json' => $input['connection_string'] ?? ''
                 ];
            }
        }

        $config = json_encode($configData, JSON_INVALID_UTF8_SUBSTITUTE);
        $isActive = filter_var($input['is_active'] ?? true, FILTER_VALIDATE_BOOLEAN);
        $isDefault = filter_var($input['is_default'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if ($isDefault) {
            // Unset other defaults
            $pdo->exec("UPDATE dms_storage_profiles SET is_default = false");
        }

        if ($id) {
            $sql = "UPDATE dms_storage_profiles SET name=:name, type=:type, configuration=:config, is_active=:active, is_default=:def WHERE rec_id=:id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':name'=>$name, ':type'=>$type, ':config'=>$config, ':active'=>$isActive? 'true':'false', ':def'=>$isDefault?'true':'false', ':id'=>$id]);
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
        
        $stmt = $pdo->prepare("DELETE FROM dms_storage_profiles WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        
        echo json_encode(['success' => true]);
        exit;
    }

    if ($action === 'storage_profile_test') {
        $input = json_decode(file_get_contents('php://input'), true);
        
        $type = $input['type'] ?? $input['storage_type'] ?? 'local';
        $config = $input['configuration'] ?? $input['config'] ?? [];
        
        // Ensure config is array
        if (is_string($config)) {
             $config = json_decode($config, true);
        }

        if ($type === 'google_drive') {
            require_once 'helpers/GoogleDriveStorage.php';
            try {
                // Fallback for frontend legacy structure
                $folderId = $config['folder_id'] ?? $input['base_path'] ?? '';
                $creds = $config['service_account_json'] ?? $input['connection_string'] ?? ''; 
                
                // If creds is array, json_encode it back for the constructor
                if (is_array($creds)) {
                    $creds = json_encode($creds);
                }
                
                $drive = new GoogleDriveStorage($creds, $folderId);
                $result = $drive->testConnection();
                if (($result['success'] ?? false) && !isset($result['message'])) {
                    $result['message'] = 'Připojení úspěšné. Složka: ' . ($result['folderName'] ?? 'Neznámá');
                }
                
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
             echo json_encode(['success' => false, 'error' => 'Unknown storage type (' . $type . ')']);
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

        // 1. Get Active Default Storage Profile
        $stmt = $pdo->prepare("SELECT * FROM dms_storage_profiles WHERE is_active = true AND is_default = true LIMIT 1");
        $stmt->execute();
        $profile = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$profile) {
            // Fallback to local if no profile defined (Backward Compatibility)
            // But usually we should have at least the seeded local one.
            $profile = ['rec_id' => null, 'type' => 'local', 'configuration' => '{}'];
        }

        $storageType = $profile['type'];
        $config = json_decode($profile['configuration'] ?? '{}', true);

        $storagePath = ''; // Will hold either RelPath (Local) or FileID (Drive)

        if ($storageType === 'google_drive') {
            require_once 'helpers/GoogleDriveStorage.php';
            // Config mapping
            $creds = $config['service_account_json'] ?? '';
            $folderId = $config['folder_id'] ?? '';
            
            if (!$creds || !$folderId) throw new Exception("Google Drive profile is missing credentials or folder ID");

            if (is_array($creds)) $creds = json_encode($creds);

            $drive = new GoogleDriveStorage($creds, $folderId);
            
            // Upload
            $remoteName = uniqid() . '_' . $file['name'];
            $driveFile = $drive->uploadFile($file['tmp_name'], $remoteName, $file['type']);
            
            if (!isset($driveFile['id'])) {
                throw new Exception("Google Drive upload failed: " . json_encode($driveFile));
            }
            $storagePath = $driveFile['id'];

        } else {
            // LOCAL STORAGE
            $baseDir = dirname(__DIR__); 
            $uploadDir = $baseDir . '/uploads/dms';
            
            if (!is_dir($uploadDir)) {
                if (!@mkdir($uploadDir, 0777, true)) {
                    $err = error_get_last();
                    throw new Exception("Failed to create upload directory. Server Error: " . ($err['message'] ?? 'Unknown'));
                }
            }
            if (!is_writable($uploadDir)) {
                @chmod($uploadDir, 0777);
                if (!is_writable($uploadDir)) throw new Exception("Upload directory is not writable.");
            }

            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            $storageName = uniqid() . '.' . $ext;
            $targetPath = $uploadDir . '/' . $storageName;
            $relPath = 'uploads/dms/' . $storageName;

            if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
                $err = error_get_last();
                throw new Exception("Failed to move uploaded file. PHP Error: " . ($err['message'] ?? 'None'));
            }
            $storagePath = $relPath;
        }

        // DB Insert
        $sql = "INSERT INTO dms_documents (tenant_id, display_name, original_filename, file_extension, file_size_bytes, mime_type, doc_type_id, storage_path, storage_profile_id, created_by, status)
                VALUES (:tid, :dname, :oname, :ext, :size, :mime, :dtid, :path, :spid, :uid, 'new')
                RETURNING rec_id";
        
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':tid' => $tenantId,
            ':dname' => $displayName,
            ':oname' => $file['name'],
            ':ext' => $ext,
            ':size' => $file['size'],
            ':mime' => $file['type'],
            ':dtid' => $docTypeId ?: null,
            ':path' => $storagePath,
            ':spid' => $profile['rec_id'],
            ':uid' => $userId
        ]);
        
        $newId = $stmt->fetchColumn();

        // Trigger OCR (Background / Inline)
        require_once __DIR__ . '/helpers/OcrEngine.php';
        
        if ($autoOcr && $newId) {
             $ocr = new OcrEngine($pdo, $tenantId);
             try {
                 $ocrResult = $ocr->analyzeDocument($newId);
                 
                 $meta = ['attributes' => [], 'zones' => []];
                 
                 if (!empty($ocrResult['attributes'])) {
                     foreach ($ocrResult['attributes'] as $attr) {
                         $meta['attributes'][$attr['attribute_code']] = $attr['found_value'];
                         if (isset($attr['rect'])) {
                             $meta['zones'][$attr['attribute_code']] = $attr['rect'];
                         }
                     }
                 }

                 // Determine Status
                 // If obtained via Template -> 'completed' (high confidence)
                 // If obtained via Regex -> 'mapping' (needs user check)
                 $strategy = $ocrResult['strategy_used'] ?? 'Regex';
                 $ocrStatus = ($strategy === 'Template') ? 'completed' : 'mapping';
                 
                 $status = 'review'; // Always needs review

                 $upd = $pdo->prepare("UPDATE dms_documents SET ocr_status = :ost, status = :st, metadata = :meta, ocr_text_content = :txt WHERE rec_id = :id");
                 $upd->execute([
                     ':ost' => $ocrStatus,
                     ':st' => $status,
                     ':meta' => json_encode($meta, JSON_INVALID_UTF8_SUBSTITUTE),
                     ':txt' => $ocrResult['raw_text_preview'] ?? '',
                     ':id' => $newId
                 ]);
             } catch (Exception $e) {
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
    // ACTION: VIEW PREVIEW (Image of Page 1) for Interactive Draw
    // -------------------------------------------------------------------------
    if ($action === 'view_preview') {
        $id = $_GET['id'] ?? null;
        if (!$id) die("ID missing");

        // 1. Fetch Doc
        $stmt = $pdo->prepare("SELECT d.*, sp.type as storage_type, sp.configuration 
                               FROM dms_documents d
                               LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                               WHERE d.rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$doc) die("Doc not found");

        // 2. Resolve Path (Local or Drive)
        $tempPath = null;
        if (($doc['storage_type'] ?? 'local') === 'google_drive') {
            require_once 'helpers/GoogleDriveStorage.php';
            $config = json_decode($doc['configuration'] ?? '{}', true);
            $drive = new GoogleDriveStorage(json_encode($config['service_account_json']), $config['folder_id']);
            $content = $drive->downloadFile($doc['storage_path']);
            
            $ext = $doc['file_extension'] ?: 'tmp';
            $tempPath = sys_get_temp_dir() . '/' . uniqid('preview_') . '.' . $ext;
            file_put_contents($tempPath, $content);
            $localPath = $tempPath;
        } else {
            $localPath = __DIR__ . '/../' . $doc['storage_path'];
            if (!file_exists($localPath)) {
                 // Try relative fix
                 $localPath = __DIR__ . '/../uploads/dms/' . basename($doc['storage_path']);
            }
        }

        if (!file_exists($localPath)) die("File access failed");

        // 3. Convert/Serve
        $mime = $doc['mime_type'];
        
        if (strpos($mime, 'image/') === 0) {
            header("Content-Type: $mime");
            readfile($localPath);
        } elseif ($mime === 'application/pdf') {
            // Convert PDF Page 1 to JPEG
            $converted = false;
            
            // A. Try Imagick
            if (class_exists('Imagick')) {
                try {
                    $im = new Imagick();
                    $im->setResolution(150, 150);
                    $im->readImage($localPath . '[0]');
                    $im->setImageFormat('jpeg');
                    header("Content-Type: image/jpeg");
                    echo $im->getImageBlob();
                    $im->clear();
                    $converted = true;
                } catch (Exception $e) { 
                    error_log("Imagick preview failed: " . $e->getMessage());
                }
            }
            
            // B. Try PDFToPPM (if Imagick failed or missing)
            if (!$converted) {
                 $out = sys_get_temp_dir() . '/' . uniqid('ppm_');
                 $cmd = "pdftoppm -jpeg -f 1 -l 1 -singlefile " . escapeshellarg($localPath) . " " . escapeshellarg($out);
                 exec($cmd);
                 if (file_exists($out . '.jpg')) {
                     header("Content-Type: image/jpeg");
                     readfile($out . '.jpg');
                     unlink($out . '.jpg');
                     $converted = true;
                 }
            }

            if (!$converted) {
                // Fallback: Return a 1x1 pixel or placeholder
                 header("Content-Type: image/jpeg");
                 // Use a default error image or just die
                 die("Preview generation capabilities missing (Imagick/Poppler)");
            }
        } else {
            // Other types?
            die("Unsupported preview type");
        }

        // Cleanup
        if ($tempPath && file_exists($tempPath)) unlink($tempPath);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: OCR REGION (Crop & Recognize)
    // -------------------------------------------------------------------------
    if ($action === 'ocr_region') {
        $input = json_decode(file_get_contents('php://input'), true);
        $docId = $input['doc_id'] ?? null;
        $rect = $input['rect'] ?? null; // {x, y, w, h} 0-1

        if (!$docId || !$rect) { http_response_code(400); echo json_encode(['success'=>false, 'error'=>'Missing params']); exit; }

        // Fetch Doc & Content (Similar logic as Preview)
        // Ideally refactor resolveFile logic to helper, but duplicating for speed now
        // ... (Resolving Local Path)
        $stmt = $pdo->prepare("SELECT d.*, sp.type as storage_type, sp.configuration 
                               FROM dms_documents d
                               LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                               WHERE d.rec_id = :id");
        $stmt->execute([':id' => $docId]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);
        
        $tempPath = null;
        $localPath = null;

        if (($doc['storage_type'] ?? 'local') === 'google_drive') {
             require_once 'helpers/GoogleDriveStorage.php';
             $config = json_decode($doc['configuration'] ?? '{}', true);
             $drive = new GoogleDriveStorage(json_encode($config['service_account_json']), $config['folder_id']);
             $content = $drive->downloadFile($doc['storage_path']);
             $ext = $doc['file_extension'] ?: 'tmp';
             $tempPath = sys_get_temp_dir() . '/' . uniqid('ocr_src_') . '.' . $ext;
             file_put_contents($tempPath, $content);
             $localPath = $tempPath;
        } else {
             $localPath = __DIR__ . '/../' . $doc['storage_path'];
             if (!file_exists($localPath)) $localPath = __DIR__ . '/../uploads/dms/' . basename($doc['storage_path']);
        }

        // Prepare Image Source for Cropping
        $imagePath = $localPath;
        $tempImg = null;

        if ($doc['mime_type'] === 'application/pdf') {
             // Convert Page 1 to JPEG for cropping
             $tempImg = sys_get_temp_dir() . '/' . uniqid('crop_src_') . '.jpg';
             // Default to pdftoppm if available for speed
             $cmd = "pdftoppm -jpeg -f 1 -l 1 -singlefile " . escapeshellarg($localPath) . " " . escapeshellarg(str_replace('.jpg','',$tempImg));
             exec($cmd);
             if (!file_exists($tempImg)) {
                 // Try Imagick
                 if (class_exists('Imagick')) {
                     try {
                         $im = new Imagick();
                         $im->setResolution(300, 300); // Higher res for OCR
                         $im->readImage($localPath . '[0]');
                         $im->setImageFormat('jpeg');
                         $im->writeImage($tempImg);
                         $im->clear();
                     } catch(Exception $e) {}
                 }
             }
             $imagePath = $tempImg;
        }

        if (!file_exists($imagePath)) {
             if ($tempPath) unlink($tempPath);
             echo json_encode(['success'=>false, 'error'=>'Failed to prepare image for OCR']); 
             exit;
        }

        // CROP using GD
        $info = getimagesize($imagePath);
        $srcW = $info[0];
        $srcH = $info[1];
        $type = $info[2];

        $cropX = floor($rect['x'] * $srcW);
        $cropY = floor($rect['y'] * $srcH);
        $cropW = floor($rect['w'] * $srcW);
        $cropH = floor($rect['h'] * $srcH);

        // Validations
        if ($cropW < 1) $cropW = 1; if ($cropH < 1) $cropH = 1;

        $srcImg = null;
        switch ($type) {
            case IMAGETYPE_JPEG: $srcImg = imagecreatefromjpeg($imagePath); break;
            case IMAGETYPE_PNG: $srcImg = imagecreatefrompng($imagePath); break;
            case IMAGETYPE_GIF: $srcImg = imagecreatefromgif($imagePath); break;
        }

        if (!$srcImg) {
             echo json_encode(['success'=>false, 'error'=>'GD failed to load image']);
             exit;
        }

        $destImg = imagecreatetruecolor($cropW, $cropH);
        imagecopy($destImg, $srcImg, 0, 0, $cropX, $cropY, $cropW, $cropH);

        // Save Crop
        $cropFile = sys_get_temp_dir() . '/' . uniqid('crop_out_') . '.jpg';
        imagejpeg($destImg, $cropFile, 90);
        
        imagedestroy($srcImg);
        imagedestroy($destImg);

        // RUN TESSERACT
        $cmd = "tesseract " . escapeshellarg($cropFile) . " stdout -l ces+eng --psm 6"; // PSM 6 = Block of text
        $output = [];
        exec($cmd, $output);
        $text = trim(implode("\n", $output));

        // Cleanup
        if ($tempPath) unlink($tempPath);
        if ($tempImg && file_exists($tempImg)) unlink($tempImg);
        if (file_exists($cropFile)) unlink($cropFile);

        echo json_encode(['success' => true, 'text' => $text]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: VIEW RAW (For iframe)
    // -------------------------------------------------------------------------
    if ($action === 'view' || $action === 'view_raw') {
        $id = $_GET['id'] ?? null;
        if (!$id) die("ID missing");

        // Fetch doc AND storage profile info
        $sql = "SELECT d.*, sp.type as storage_type, sp.configuration 
                FROM dms_documents d
                LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                WHERE d.rec_id = :id";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) die("Document not found");

        header("Content-Type: " . $doc['mime_type']);
        header("Content-Disposition: inline; filename=\"" . ($doc['original_filename'] ?: 'document') . "\"");

        $type = $doc['storage_type'] ?? 'local'; 
        
        // Handle Google Drive
        if ($type === 'google_drive') {
            require_once 'helpers/GoogleDriveStorage.php';
            $config = json_decode($doc['configuration'] ?? '{}', true);
            $creds = $config['service_account_json'] ?? '';
            $folderId = $config['folder_id'] ?? ''; // Not needed for download but constructor needs it?

            // If creds missing, we can't download
            if (!$creds) die("Storage credentials missing");

            if (is_array($creds)) $creds = json_encode($creds);

            try {
                $drive = new GoogleDriveStorage($creds, $folderId);
                $content = $drive->downloadFile($doc['storage_path']); // storage_path is File ID
                echo $content;
            } catch (Exception $e) {
                http_response_code(500);
                echo "Error downloading file from Drive: " . $e->getMessage();
            }
            exit;
        }

        // Handle Local
        $path = __DIR__ . '/../' . $doc['storage_path'];
        if (!file_exists($path)) {
            // Try fallback? No.
            die("File not found on server");
        }

        readfile($path);
        exit;
    }

    throw new Exception("Unknown action: $action");

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
