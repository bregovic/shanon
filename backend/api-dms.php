<?php
// backend/api-dms.php
error_reporting(E_ALL);
ini_set('display_errors', 0); // Keep 0 for JSON API, but use log if possible.
// Actually, if we want to see the error in the response body (invalid json but visible text), set to 1 temporarily.
ini_set('display_errors', 1); 

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';
require_once 'helpers/OcrEngine.php';
// GoogleDriveStorage loaded on demand

// Ensure no output before this:
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
        
        $json = json_encode(['success' => true, 'data' => $docs], JSON_INVALID_UTF8_SUBSTITUTE);
        if ($json === false) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'JSON Encoding Error: ' . json_last_error_msg()]);
        } else {
            echo $json;
        }
        exit;
    }

    // ===== LIST DOCUMENT TYPES =====
    if ($action === 'types') {
        // Fetch types with their active attributes count
        $sql = "SELECT t.*, 
                (SELECT COUNT(*) FROM dms_doc_type_attributes da 
                 JOIN dms_attributes a ON da.attribute_id = a.rec_id 
                 WHERE da.doc_type_id = t.rec_id) as attr_count
                FROM dms_doc_types t 
                WHERE t.is_active = true 
                ORDER BY t.name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        $types = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode(['success' => true, 'data' => $types]);
        exit;
    }

    // ===== LIST ATTRIBUTES FOR SPECIFIC DOC TYPE =====
    if ($action === 'doc_type_attributes') {
        $id = $_GET['id'] ?? 0;
        $sql = "SELECT a.*, da.is_required as is_linked_required, da.display_order 
                FROM dms_attributes a
                JOIN dms_doc_type_attributes da ON a.rec_id = da.attribute_id
                WHERE da.doc_type_id = ?
                ORDER BY da.display_order, a.name";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$id]);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // ===== LINK ATTRIBUTE TO DOC TYPE =====
    if ($action === 'doc_type_attribute_add' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        $typeId = $data['doc_type_id'];
        $attrId = $data['attribute_id'];
        $required = $data['is_required'] ?? false;
        
        // Remove existing link if any (to update)
        $pdo->prepare("DELETE FROM dms_doc_type_attributes WHERE doc_type_id=? AND attribute_id=?")->execute([$typeId, $attrId]);
        
        $stmt = $pdo->prepare("INSERT INTO dms_doc_type_attributes (doc_type_id, attribute_id, is_required) VALUES (?, ?, ?)");
        $stmt->execute([$typeId, $attrId, $required ? 't' : 'f']);
        
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== UNLINK ATTRIBUTE FROM DOC TYPE =====
    if ($action === 'doc_type_attribute_remove' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        $typeId = $data['doc_type_id'];
        $attrId = $data['attribute_id'];
        
        $pdo->prepare("DELETE FROM dms_doc_type_attributes WHERE doc_type_id=? AND attribute_id=?")->execute([$typeId, $attrId]);
        echo json_encode(['success' => true]);
        exit;
    }

    // ===== BATCH SYNC ATTRIBUTES TO DOC TYPE =====
    if ($action === 'doc_type_attributes_sync' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        $typeId = $data['doc_type_id'];
        $attributeIds = $data['attribute_ids'] ?? []; // Array of IDs

        if (!$typeId) throw new Exception('Missing Doc Type ID');

        $pdo->beginTransaction();
        try {
            // 1. Remove all existing for this type
            $pdo->prepare("DELETE FROM dms_doc_type_attributes WHERE doc_type_id=?")->execute([$typeId]);
            
            // 2. Insert new ones
            $stmt = $pdo->prepare("INSERT INTO dms_doc_type_attributes (doc_type_id, attribute_id, is_required) VALUES (?, ?, 'f')");
            foreach ($attributeIds as $attrId) {
                $stmt->execute([$typeId, $attrId]);
            }
            $pdo->commit();
            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
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
        // Note: tmp_name is gone after move_uploaded_file, so read from the new location logic
        $content = file_get_contents($fullPath);
        if ($content !== false && strlen($content) > 0) {
             $stmtBlob = $pdo->prepare("INSERT INTO dms_file_contents (doc_id, content) VALUES (:id, :content)");
             // Bind as parameter (PDO handles escaping for Bytea)
             $stmtBlob->bindParam(':id', $newId);
             $stmtBlob->bindParam(':content', $content, PDO::PARAM_LOB);
             $stmtBlob->execute();
        }

        // --- AUTOMATIC OCR & TEMPLATE MATCHING ---
        if ($enableOcr) {
            try {
                require_once __DIR__ . '/helpers/OcrEngine.php';
                $engine = new OcrEngine($pdo, $tenantId);
                
                // This performs smart extraction (regex/keywords)
                // TODO: enhance OcrEngine to check dms_ocr_templates ("mapping") if needed.
                // For now, this satisfies "make OCR extraction".
                $ocrRes = $engine->analyzeDocument($newId);
                
                if ($ocrRes['success'] && !empty($ocrRes['attributes'])) {
                    $extracted = [];
                    foreach ($ocrRes['attributes'] as $attr) {
                         // Use CODE if available, else NAME
                         $key = !empty($attr['attribute_code']) ? $attr['attribute_code'] : $attr['attribute_name'];
                         $extracted[$key] = $attr['found_value'];
                    }
                    
                    // Update Metadata
                    $metaJson = json_encode(['attributes' => $extracted]);
                    $stmtUpd = $pdo->prepare("UPDATE dms_documents SET metadata = :meta, ocr_status = 'completed' WHERE rec_id = :id");
                    $stmtUpd->execute([':meta' => $metaJson, ':id' => $newId]);
                    
                } else {
                    // No attributes found - mark completed but maybe with warning?
                    // Or keep as 'mapping' if we assume manual mapping is needed?
                    $pdo->exec("UPDATE dms_documents SET ocr_status = 'completed' WHERE rec_id = $newId");
                }
            } catch (Exception $e) {
                // Don't fail the upload, just log/warn
                $uploadWarning .= " OCR Failed: " . $e->getMessage();
                error_log("Auto-OCR Error for Doc $newId: " . $e->getMessage());
            }
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

    // ===== DELETE DOCUMENT (BATCH SUPPORT) =====
    if ($action === 'delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = $input['id'] ?? 0;
        $ids = $input['ids'] ?? [];

        if ($id) $ids[] = $id;
        
        if (empty($ids)) throw new Exception('ID or IDs required');

        // Delete multiple
        foreach ($ids as $docId) {
             // 1. Fetch File Info to delete physical file
             try {
                $stmtDoc = $pdo->prepare("
                    SELECT d.storage_path, p.provider_type, p.base_path, p.connection_string 
                    FROM dms_documents d
                    LEFT JOIN dms_storage_profiles p ON d.storage_profile_id = p.rec_id
                    WHERE d.rec_id = :id
                ");
                $stmtDoc->execute([':id' => $docId]);
                $doc = $stmtDoc->fetch(PDO::FETCH_ASSOC);

                if ($doc) {
                    $path = $doc['storage_path'];
                    
                    if ($doc['provider_type'] === 'local') {
                        $fullPath = __DIR__ . '/' . $path;
                        if (file_exists($fullPath)) {
                            unlink($fullPath);
                        }
                    } elseif ($doc['provider_type'] === 'google_drive') {
                        // Load helper if needed
                        if (!class_exists('GoogleDriveStorage')) {
                            require_once __DIR__ . '/helpers/GoogleDriveStorage.php';
                        }
                        try {
                            $gd = new GoogleDriveStorage($doc['connection_string'], $doc['base_path']);
                            $gd->deleteFile($path); // path is File ID
                        } catch (Exception $e) {
                            // Log warning but continue? 
                            error_log("Google Drive delete failed: " . $e->getMessage());
                        }
                    }
                }
             } catch (Exception $e) {
                 error_log("Physical delete failed for doc $docId: " . $e->getMessage());
             }

             // 2. Delete DB Record
             $pdo->prepare("DELETE FROM dms_documents WHERE rec_id = :id")->execute([':id' => $docId]);
        }

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

    // ===== OCR REGION (Interactive) =====
    if ($action === 'ocr_region') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['doc_id'] ?? 0;
        $rect = $input['rect'] ?? null; // {x, y, w, h} in % (0-1)

        if (!$id || !$rect) throw new Exception('Missing ID or Rect');

        // Fetch Doc
        $stmt = $pdo->prepare("SELECT storage_path, mime_type, file_extension, display_name FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) throw new Exception('Document not found');

        // Resolve Path (reuse logic)
        $filepath = $doc['storage_path'];
        // If relative...
        if (!file_exists($filepath) && file_exists(__DIR__ . '/' . $filepath)) {
            $filepath = __DIR__ . '/' . $filepath;
        }

        require_once __DIR__ . '/helpers/PdfRenderer.php';

        try {
            // Load Image
            $srcImg = null;
            $isPdf = $doc['mime_type'] === 'application/pdf' || $doc['file_extension'] === 'pdf';

            if ($isPdf) {
                // Render PDF to Image first
                $imgBlob = PdfRenderer::renderPage($filepath, 0);
                if (!$imgBlob) throw new Exception('Nelze převést PDF na obrázek (chybí Imagick/Ghostscript).');
                $srcImg = imagecreatefromstring($imgBlob);
            } else {
                // Standard Image
                if ($doc['mime_type'] === 'image/jpeg' || $doc['file_extension'] === 'jpg') $srcImg = @imagecreatefromjpeg($filepath);
                elseif ($doc['mime_type'] === 'image/png' || $doc['file_extension'] === 'png') $srcImg = @imagecreatefrompng($filepath);
            }
            
            if (!$srcImg) throw new Exception('Nepodařilo se načíst obrázek (GD Library error).');

            $origW = imagesx($srcImg);
            $origH = imagesy($srcImg);

            // Calculate Crop
            $x = (int)($rect['x'] * $origW);
            $y = (int)($rect['y'] * $origH);
            $w = (int)($rect['w'] * $origW);
            $h = (int)($rect['h'] * $origH);

            // Sanity Check
            if ($w < 1 || $h < 1) throw new Exception('Příliš malá zóna.');
            
            // Limit to bounds
            if ($x < 0) $x = 0; 
            if ($y < 0) $y = 0;
            if ($x + $w > $origW) $w = $origW - $x;
            if ($y + $h > $origH) $h = $origH - $y;

            $crop = imagecrop($srcImg, ['x' => $x, 'y' => $y, 'width' => $w, 'height' => $h]);
            
            if ($crop !== false) {
                $tempFile = sys_get_temp_dir() . '/ocr_crop_' . uniqid() . '.png';
                imagepng($crop, $tempFile);
                imagedestroy($crop);
                imagedestroy($srcImg);

                // Run Tesseract
                $cmd = "tesseract " . escapeshellarg($tempFile) . " stdout -l ces+eng --psm 7";
                $output = [];
                $ret = 0;
                exec($cmd, $output, $ret);
                
                unlink($tempFile);

                if ($ret === 0) {
                    $text = trim(implode(" ", $output));
                    echo json_encode(['success' => true, 'text' => $text]);
                } else {
                    echo json_encode(['success' => false, 'error' => 'Tesseract failed']);
                }
            } else {
                echo json_encode(['success' => false, 'error' => 'Crop failed']);
            }
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    // ===== VIEW RAW (for iframe PDF) =====
    if ($action === 'view_raw') {
        $id = $_GET['id'] ?? 0;
        if (!$id) { http_response_code(400); exit; }

        $stmt = $pdo->prepare("SELECT storage_path, mime_type FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) { http_response_code(404); exit; }

        $filepath = $doc['storage_path'];
        // Path fix if relative
        if (!file_exists($filepath) && file_exists(__DIR__ . '/' . $filepath)) {
            $filepath = __DIR__ . '/' . $filepath;
        }

        if (file_exists($filepath)) {
            header('Content-Type: ' . $doc['mime_type']);
            header('Content-Length: ' . filesize($filepath));
            readfile($filepath);
            exit;
        } else {
            http_response_code(404);
            echo "File not found on disk.";
            exit;
        }
    }

    // ===== PREVIEW IMAGE (For PDF/Image interactive zoning) =====
    if ($action === 'view_preview') {
        $id = $_GET['id'] ?? 0;
        if (!$id) { http_response_code(400); exit; }

        $stmt = $pdo->prepare("SELECT storage_path, mime_type FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) { http_response_code(404); exit; }

        $filepath = $doc['storage_path'];
        if (!file_exists($filepath) && file_exists(__DIR__ . '/' . $filepath)) {
            $filepath = __DIR__ . '/' . $filepath;
        }

        require_once __DIR__ . '/helpers/PdfRenderer.php';

        $isPdf = $doc['mime_type'] === 'application/pdf'; // or extension check
        
        if ($isPdf) {
            $blob = PdfRenderer::renderPage($filepath, 0);
            if ($blob) {
                header('Content-Type: image/jpeg');
                echo $blob;
                exit;
            }
        } else {
             // If it's already an image, redirect to view or output it
             // Let's output it via GD to ensure consistent orient/type, or just readfile
             if (file_exists($filepath)) {
                 $mime = mime_content_type($filepath);
                 header('Content-Type: ' . $mime);
                 readfile($filepath);
                 exit;
             }
        }
        
        // Fallback: Return a placeholder image
        $im = imagecreate(800, 1000);
        $bg = imagecolorallocate($im, 240, 240, 240);
        $text_color = imagecolorallocate($im, 200, 0, 0);
        imagestring($im, 5, 50, 50,  'Preview not available', $text_color);
        imagestring($im, 3, 50, 80,  'Imagick/Ghostscript missing on server', $text_color);
        header('Content-Type: image/png');
        imagepng($im);
        imagedestroy($im);
        exit;
    }


    // ===== OCR ANALYZE DOCUMENT (BATCH SUPPORT) =====
    if ($action === 'analyze_doc') {
        $input = json_decode(file_get_contents('php://input'), true) ?? $_GET; // Support POST too
        $id = (int)($input['id'] ?? $_GET['id'] ?? 0);
        $ids = $input['ids'] ?? [];

        if ($id) $ids[] = $id;

        if (empty($ids)) throw new Exception('ID or IDs required');

        $tenantId = '00000000-0000-0000-0000-000000000001';
        $engine = new OcrEngine($pdo, $tenantId);

        $results = [];
        foreach($ids as $docId) {
            $result = $engine->analyzeDocument($docId);

            if ($result['success'] && !empty($result['attributes'])) {
                $extracted = [];
                foreach ($result['attributes'] as $attr) {
                    $key = $attr['attribute_name'];
                    $extracted[$key] = $attr['found_value'];
                }
                $metaJson = json_encode(['attributes' => $extracted]);
                
                $sql = "UPDATE dms_documents 
                        SET metadata = metadata || :new_meta, 
                            ocr_status = 'completed',
                            status = 'review' 
                        WHERE rec_id = :id";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([':new_meta' => $metaJson, ':id' => $docId]);
            } else {
                 $sql = "UPDATE dms_documents SET ocr_status = 'completed', status = 'review' WHERE rec_id = :id";
                 $pdo->prepare($sql)->execute([':id' => $docId]);
            }
            $results[$docId] = $result;
        }

        // If single, return single structure for backward compat
        if (count($ids) === 1) {
            echo json_encode($results[$ids[0]]);
        } else {
            echo json_encode(['success' => true, 'batch_results' => $results]);
        }
        exit;
    }

    // ===== UPDATE METADATA (MANUAL CORRECTION) =====
    if ($action === 'update_metadata' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['id'] ?? 0;
        $attributes = $input['attributes'] ?? [];
        $newStatus = $input['status'] ?? null; // e.g. 'verified', 'exported'

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
        // We try to update 'status' column. If it fails (migration not run), we fallback to just ocr_status.
        // Since we can't easily try-catch SQL prepare in PDO without overhead, we'll try to check column existence or just assume migration 030 runs.
        // Given constraint: specific migration 030 adds 'status'.
        
        $ocrStatus = 'completed'; // Default to completed (OCR done, but not approved)
        $workflowStatus = 'review'; // Default workflow status

        if ($newStatus === 'verified') {
             $ocrStatus = 'verified'; 
             $workflowStatus = 'approved';
        } elseif ($newStatus) {
             $workflowStatus = $newStatus;
             $ocrStatus = $newStatus; // fallback sync
        }
        
        // Dynamic Update Builder
        $fields = ["metadata = :meta", "ocr_status = :ocr_status"];
        $params = [':meta' => json_encode($currMeta), ':ocr_status' => $ocrStatus, ':id' => $id];
        
        // Always try to update status if we have a valid workflow status
        if ($workflowStatus) {
            $fields[] = "status = :status";
            $params[':status'] = $workflowStatus;
        }

        $sql = "UPDATE dms_documents SET " . implode(', ', $fields) . " WHERE rec_id = :id";
        
        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
        } catch (PDOException $e) {
            // Likely 'status' column missing or other SQL error
            if ($newStatus) {
                // Retry without status
                 $sql = "UPDATE dms_documents SET metadata = :meta, ocr_status = :ocr_status WHERE rec_id = :id";
                 unset($params[':status']);
                 $stmt = $pdo->prepare($sql);
                 $stmt->execute($params);
            } else {
                throw $e;
            }
        }

        echo json_encode(['success' => true]);
        exit;
    }

    // ===== ADMIN: DOCUMENT TYPES =====
    if ($action === 'doc_types') {
        $sql = "SELECT t.*, s.name as number_series_name,
                (SELECT COUNT(*) FROM dms_doc_type_attributes da 
                 JOIN dms_attributes a ON da.attribute_id = a.rec_id 
                 WHERE da.doc_type_id = t.rec_id) as attr_count
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
