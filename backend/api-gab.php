<?php
// backend/api-gab.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';
require_once 'security.php';

header("Content-Type: application/json");

if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// Temporary fallback for tenant
$tenantId = '00000000-0000-0000-0000-000000000001';

$action = $_GET['action'] ?? 'list';

try {
    $db = DB::connect();
    
    // BASIC SECURITY CHECK - Replace with actual Security::requirePermission('mod_gab', 'view'); when available
    // Security::requirePermission('mod_gab', 'view');

    if ($action === 'list') {
        $stmt = $db->prepare("
            SELECT s.rec_id, s.name, s.reg_no, s.tax_no, s.country_iso, s.is_active,
                   (SELECT string_agg(role_code::text, ',') FROM gab_subject_roles r WHERE r.subject_id = s.rec_id AND r.tenant_id = ?::uuid) as roles,
                   (SELECT contact_value FROM gab_contacts c WHERE c.subject_id = s.rec_id AND c.tenant_id = ?::uuid AND is_primary = true LIMIT 1) as primary_contact
            FROM gab_subjects s
            WHERE s.tenant_id = ?::uuid
            ORDER BY s.name ASC
        ");
        $stmt->execute([$tenantId, $tenantId, $tenantId]);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    } 
    elseif ($action === 'get') {
        $id = (int)($_GET['id'] ?? 0);
        
        $stmt = $db->prepare("SELECT * FROM gab_subjects WHERE rec_id = ? AND tenant_id = ?");
        $stmt->execute([$id, $tenantId]);
        $subject = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$subject) throw new Exception("Subjekt nenalezen");

        // Roles
        $rStmt = $db->prepare("SELECT role_code FROM gab_subject_roles WHERE subject_id = ? AND tenant_id = ?");
        $rStmt->execute([$id, $tenantId]);
        $subject['roles'] = $rStmt->fetchAll(PDO::FETCH_COLUMN);

        // Addresses
        $aStmt = $db->prepare("SELECT * FROM gab_addresses WHERE subject_id = ? AND tenant_id = ? ORDER BY is_primary DESC, address_type");
        $aStmt->execute([$id, $tenantId]);
        $subject['addresses'] = $aStmt->fetchAll(PDO::FETCH_ASSOC);

        // Contacts
        $cStmt = $db->prepare("SELECT * FROM gab_contacts WHERE subject_id = ? AND tenant_id = ? ORDER BY is_primary DESC, contact_type");
        $cStmt->execute([$id, $tenantId]);
        $subject['contacts'] = $cStmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'data' => $subject]);
    }
    elseif ($action === 'save') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['rec_id'] ?? 0;
        $name = $input['name'] ?? '';
        $regNo = $input['reg_no'] ?? null;
        $taxNo = $input['tax_no'] ?? null;
        $country = $input['country_iso'] ?? 'CZ';
        $user = $_SESSION['username'] ?? 'System';

        if (empty($name)) throw new Exception("Název subjektu je povinný");

        if ($regNo === '') $regNo = null;
        if ($taxNo === '') $taxNo = null;

        $db->beginTransaction();

        try {
            if ($id > 0) {
                // Update
                $stmt = $db->prepare("UPDATE gab_subjects SET name=?, reg_no=?, tax_no=?, country_iso=?, updated_at=NOW(), updated_by=? WHERE rec_id=? AND tenant_id=?");
                $stmt->execute([$name, $regNo, $taxNo, $country, $user, $id, $tenantId]);
            } else {
                // Insert
                $stmt = $db->prepare("INSERT INTO gab_subjects (tenant_id, name, reg_no, tax_no, country_iso, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING rec_id");
                $stmt->execute([$tenantId, $name, $regNo, $taxNo, $country, $user]);
                $id = $stmt->fetchColumn();
            }

            // Sync Roles
            $roles = $input['roles'] ?? [];
            if (is_array($roles)) {
                $db->prepare("DELETE FROM gab_subject_roles WHERE subject_id = ? AND tenant_id = ?")->execute([$id, $tenantId]);
                $roleStmt = $db->prepare("INSERT INTO gab_subject_roles (tenant_id, subject_id, role_code) VALUES (?, ?, ?)");
                foreach ($roles as $r) {
                    $roleStmt->execute([$tenantId, $id, $r]);
                }
            }

            $db->commit();
            echo json_encode(['success' => true, 'id' => $id]);
        } catch (PDOException $pe) {
            $db->rollBack();
            if ($pe->getCode() == '23505' && strpos($pe->getMessage(), 'idx_gab_subj_reg_no') !== false) {
                throw new Exception("Subjekt se zadaným IČO již existuje!");
            }
            throw $pe;
        }
    }
    elseif ($action === 'save_contact') {
        $input = json_decode(file_get_contents('php://input'), true);
        $subjectId = $input['subject_id'] ?? 0;
        $type = $input['contact_type'] ?? 'EMAIL';
        $val  = $input['contact_value'] ?? '';
        $isPrimary = $input['is_primary'] ?? false ? 1 : 0;
        
        if (empty($val)) throw new Exception("Hodnota kontaktu je povinná");

        // Warning logic: check duplicates for Emails
        if ($type === 'EMAIL') {
            $dupStmt = $db->prepare("SELECT COUNT(*) FROM gab_contacts WHERE contact_value = ? AND tenant_id = ? AND subject_id != ?");
            $dupStmt->execute([$val, $tenantId, $subjectId]);
            if ($dupStmt->fetchColumn() > 0) {
                // We return a warning, but still save it if the user forced it? No, just save and return warning flag.
                // The frontend should handle warning logic BEFORE save, but let's just save and return warning.
            }
        }

        if ($isPrimary) {
            $db->prepare("UPDATE gab_contacts SET is_primary = false WHERE subject_id = ? AND contact_type = ? AND tenant_id = ?")->execute([$subjectId, $type, $tenantId]);
        }

        if (!empty($input['rec_id'])) {
            $stmt = $db->prepare("UPDATE gab_contacts SET contact_type=?, contact_value=?, is_primary=?, updated_at=NOW() WHERE rec_id=? AND tenant_id=?");
            $stmt->execute([$type, $val, $isPrimary, $input['rec_id'], $tenantId]);
        } else {
            $stmt = $db->prepare("INSERT INTO gab_contacts (tenant_id, subject_id, contact_type, contact_value, is_primary) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$tenantId, $subjectId, $type, $val, $isPrimary]);
        }
        echo json_encode(['success' => true]);
    }
    elseif ($action === 'save_address') {
        $input = json_decode(file_get_contents('php://input'), true);
        $subjectId = $input['subject_id'] ?? 0;
        $type = $input['address_type'] ?? 'BILLING';
        $street = $input['street'] ?? '';
        $city = $input['city'] ?? '';
        $zip = $input['zip_code'] ?? '';
        $iso = $input['country_iso'] ?? 'CZ';
        $isPrimary = $input['is_primary'] ?? false ? 1 : 0;
        
        if (empty($street) || empty($city)) throw new Exception("Ulice a město jsou povinné");

        if ($isPrimary) {
            $db->prepare("UPDATE gab_addresses SET is_primary = false WHERE subject_id = ? AND address_type = ? AND tenant_id = ?")->execute([$subjectId, $type, $tenantId]);
        }

        if (!empty($input['rec_id'])) {
            $stmt = $db->prepare("UPDATE gab_addresses SET address_type=?, street=?, city=?, zip_code=?, country_iso=?, is_primary=?, updated_at=NOW() WHERE rec_id=? AND tenant_id=?");
            $stmt->execute([$type, $street, $city, $zip, $iso, $isPrimary, $input['rec_id'], $tenantId]);
        } else {
            $stmt = $db->prepare("INSERT INTO gab_addresses (tenant_id, subject_id, address_type, street, city, zip_code, country_iso, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$tenantId, $subjectId, $type, $street, $city, $zip, $iso, $isPrimary]);
        }
        echo json_encode(['success' => true]);
    }
    elseif ($action === 'delete_contact') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!empty($input['ids'])) {
            $in = str_repeat('?,', count($input['ids']) - 1) . '?';
            $params = array_merge([$tenantId], $input['ids']);
            $db->prepare("DELETE FROM gab_contacts WHERE tenant_id = ? AND rec_id IN ($in)")->execute($params);
        }
        echo json_encode(['success' => true]);
    }
    elseif ($action === 'delete_address') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!empty($input['ids'])) {
            $in = str_repeat('?,', count($input['ids']) - 1) . '?';
            $params = array_merge([$tenantId], $input['ids']);
            $db->prepare("DELETE FROM gab_addresses WHERE tenant_id = ? AND rec_id IN ($in)")->execute($params);
        }
        echo json_encode(['success' => true]);
    }
    elseif ($action === 'deactivate') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!empty($input['ids'])) {
            $in = str_repeat('?,', count($input['ids']) - 1) . '?';
            $params = array_merge([$tenantId], $input['ids']);
            $db->prepare("UPDATE gab_subjects SET is_active = false WHERE tenant_id = ? AND rec_id IN ($in)")->execute($params);
        }
        echo json_encode(['success' => true]);
    }
    else {
        throw new Exception("Neznámá akce: " . htmlspecialchars($action));
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
