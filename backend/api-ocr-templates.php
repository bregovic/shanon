<?php
require_once 'auth.php'; // Handle CORS, Session, DB connection

// Ensure User is Admin or has rights
// if (!isset($_SESSION['user_id'])) { http_response_code(401); echo json_encode(['error' => 'Unauthorized']); exit; }

$action = $_GET['action'] ?? 'list';
$tenantId = $_SESSION['tenant_id'] ?? 1;

header('Content-Type: application/json');

try {
    
    // -------------------------------------------------------------------------
    // ACTION: LIST
    // -------------------------------------------------------------------------
    if ($action === 'list') {
        $stmt = $pdo->prepare("
            SELECT t.*, dt.name as doc_type_name, 
                   (SELECT COUNT(*) FROM dms_ocr_template_zones z WHERE z.template_id = t.rec_id) as zone_count
            FROM dms_ocr_templates t
            LEFT JOIN dms_doc_types dt ON t.doc_type_id = dt.rec_id
            WHERE t.tenant_id = :tid OR t.tenant_id IS NULL
            ORDER BY t.created_at DESC
        ");
        $stmt->execute([':tid' => $tenantId]);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: GET
    // -------------------------------------------------------------------------
    if ($action === 'get') {
        $id = $_GET['id'] ?? null;
        if (!$id) throw new Exception("ID required");

        $stmt = $pdo->prepare("SELECT * FROM dms_ocr_templates WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $template = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$template) throw new Exception("Template not found");

        // Fetch zones
        $stmtZones = $pdo->prepare("SELECT * FROM dms_ocr_template_zones WHERE template_id = :tid");
        $stmtZones->execute([':tid' => $id]);
        $zones = $stmtZones->fetchAll(PDO::FETCH_ASSOC);

        // Map zones for frontend
        $mappedZones = array_map(function($z) {
            return [
                'id' => 'db_' . $z['rec_id'],
                'attribute_code' => $z['attribute_code'],
                'x' => (float)$z['rect_x'],
                'y' => (float)$z['rect_y'],
                'width' => (float)$z['rect_w'],
                'height' => (float)$z['rect_h'],
                'data_type' => $z['data_type'],
                'regex_pattern' => $z['regex_pattern']
            ];
        }, $zones);

        echo json_encode(['success' => true, 'data' => ['template' => $template, 'zones' => $mappedZones]]);
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: SAVE (Create/Update)
    // -------------------------------------------------------------------------
    if ($action === 'save') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) throw new Exception("Invalid input");

        $id = $input['rec_id'] ?? $input['id'] ?? null;
        $name = $input['name'] ?? 'Unnamed Template';
        $docTypeId = $input['doc_type_id'] ?? null;
        $anchorText = $input['anchor_text'] ?? '';
        $sampleDocId = $input['sample_doc_id'] ?? null;
        $zones = $input['zones'] ?? [];

        $pdo->beginTransaction();

        try {
            if ($id) {
                // UPDATE
                $sql = "UPDATE dms_ocr_templates SET name=:name, doc_type_id=:dtid, anchor_text=:anchor, sample_doc_id=:sdoc, updated_at=NOW() WHERE rec_id=:id";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([
                    ':name' => $name, 
                    ':dtid' => $docTypeId ?: null, 
                    ':anchor' => $anchorText, 
                    ':sdoc' => $sampleDocId ?: null,
                    ':id' => $id
                ]);
                
                // Replace zones (simplest strategy: delete all for this template and re-insert)
                $pdo->prepare("DELETE FROM dms_ocr_template_zones WHERE template_id = :tid")->execute([':tid' => $id]);
                $templateId = $id;

            } else {
                // INSERT
                $sql = "INSERT INTO dms_ocr_templates (tenant_id, name, doc_type_id, anchor_text, sample_doc_id) VALUES (:tid, :name, :dtid, :anchor, :sdoc) RETURNING rec_id";
                $stmt = $pdo->prepare($sql);
                $stmt->execute([
                    ':tid' => $tenantId,
                    ':name' => $name, 
                    ':dtid' => $docTypeId ?: null, 
                    ':anchor' => $anchorText,
                    ':sdoc' => $sampleDocId ?: null
                ]);
                $templateId = $stmt->fetchColumn();
            }

            // Insert Zones
            if (!empty($zones)) {
                $sqlZone = "INSERT INTO dms_ocr_template_zones (template_id, attribute_code, rect_x, rect_y, rect_w, rect_h, data_type, regex_pattern) VALUES (:tid, :code, :x, :y, :w, :h, :dtype, :regex)";
                $stmtZone = $pdo->prepare($sqlZone);

                foreach ($zones as $zone) {
                    $stmtZone->execute([
                        ':tid' => $templateId,
                        ':code' => $zone['attribute_code'],
                        ':x' => $zone['x'],
                        ':y' => $zone['y'],
                        ':w' => $zone['width'],
                        ':h' => $zone['height'],
                        ':dtype' => $zone['data_type'] ?? 'text',
                        ':regex' => $zone['regex_pattern'] ?? ''
                    ]);
                }
            }

            $pdo->commit();
            echo json_encode(['success' => true, 'id' => $templateId]);
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
        exit;
    }

    // -------------------------------------------------------------------------
    // ACTION: DELETE
    // -------------------------------------------------------------------------
    if ($action === 'delete') {
         $input = json_decode(file_get_contents('php://input'), true);
         $id = $input['id'] ?? null;
         if (!$id) throw new Exception("ID required");

         $pdo->prepare("DELETE FROM dms_ocr_templates WHERE rec_id = :id")->execute([':id' => $id]);
         echo json_encode(['success' => true]);
         exit;
    }

    throw new Exception("Unknown action");

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
