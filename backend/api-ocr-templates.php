<?php
// backend/api-ocr-templates.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// Auth check
if (!isset($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$action = $_GET['action'] ?? 'list';
$pdo = DB::connect();

try {
    // === LIST TEMPLATES ===
    if ($action === 'list') {
        $stmt = $pdo->prepare("
            SELECT t.*, d.name as doc_type_name 
            FROM dms_ocr_templates t
            LEFT JOIN dms_doc_types d ON t.doc_type_id = d.rec_id
            WHERE t.is_active = true
            ORDER BY t.name
        ");
        $stmt->execute();
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    // === GET TEMPLATE DETAILS (Zones) ===
    if ($action === 'get') {
        $id = $_GET['id'] ?? 0;
        
        // Template info
        $stmt = $pdo->prepare("SELECT * FROM dms_ocr_templates WHERE rec_id = ?");
        $stmt->execute([$id]);
        $template = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$template) {
            throw new Exception("Template not found");
        }

        // Zones
        $stmtZones = $pdo->prepare("SELECT * FROM dms_ocr_zones WHERE template_id = ?");
        $stmtZones->execute([$id]);
        $zones = $stmtZones->fetchAll(PDO::FETCH_ASSOC);

        // Sample Doc URL (if creating frontend preview)
        $sampleUrl = null;
        if ($template['sample_doc_id']) {
            // In a real app, generate a secure token or link
            // For now, allow download via existing DMS API
            $sampleUrl = "/api/api-dms.php?action=download&id=" . $template['sample_doc_id'];
        }

        echo json_encode(['success' => true, 'data' => [
            'template' => $template,
            'zones' => $zones,
            'sample_url' => $sampleUrl
        ]]);
        exit;
    }

    // === SAVE TEMPLATE ===
    if ($action === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        
        $tenantId = '00000000-0000-0000-0000-000000000001';
        $name = $data['name'];
        $docTypeId = $data['doc_type_id'] ?: null;
        $anchorText = $data['anchor_text'] ?? '';
        $sampleDocId = $data['sample_doc_id'] ?: null;
        $zones = $data['zones'] ?? [];

        $pdo->beginTransaction();

        // 1. Upsert Template
        if (isset($data['rec_id']) && $data['rec_id'] > 0) {
            $id = $data['rec_id'];
            $stmt = $pdo->prepare("UPDATE dms_ocr_templates SET name=?, doc_type_id=?, anchor_text=?, sample_doc_id=? WHERE rec_id=?");
            $stmt->execute([$name, $docTypeId, $anchorText, $sampleDocId, $id]);
        } else {
            $stmt = $pdo->prepare("INSERT INTO dms_ocr_templates (tenant_id, name, doc_type_id, anchor_text, sample_doc_id) VALUES (?, ?, ?, ?, ?) RETURNING rec_id");
            $stmt->execute([$tenantId, $name, $docTypeId, $anchorText, $sampleDocId]);
            $id = $stmt->fetchColumn();
        }

        // 2. Refresh Zones (Delete all & Insert new)
        // Simplest strategy for editing
        $pdo->prepare("DELETE FROM dms_ocr_zones WHERE template_id = ?")->execute([$id]);

        $stmtZone = $pdo->prepare("INSERT INTO dms_ocr_zones (template_id, attribute_code, x, y, width, height, data_type, regex_pattern) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        
        foreach ($zones as $z) {
            $stmtZone->execute([
                $id,
                $z['attribute_code'],
                $z['x'],
                $z['y'],
                $z['width'],
                $z['height'],
                $z['data_type'] ?? 'text',
                $z['regex_pattern'] ?? ''
            ]);
        }

        $pdo->commit();
        echo json_encode(['success' => true, 'rec_id' => $id]);
        exit;
    }

    // === DELETE TEMPLATE ===
    if ($action === 'delete') {
        $id = $_GET['id'] ?? 0;
        $pdo->prepare("UPDATE dms_ocr_templates SET is_active = false WHERE rec_id = ?")->execute([$id]);
        echo json_encode(['success' => true]);
        exit;
    }

} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
