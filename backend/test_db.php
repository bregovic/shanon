<?php
require_once __DIR__ . '/db.php';
$tenantId = '00000000-0000-0000-0000-000000000001';
try {
    $db = DB::connect();
    $stmt = $db->prepare("
        SELECT s.rec_id, s.name, s.reg_no, s.tax_no, s.country_iso, s.is_active,
               (SELECT string_agg(role_code, ',') FROM gab_subject_roles r WHERE r.subject_id = s.rec_id AND r.tenant_id = ?) as roles,
               (SELECT contact_value FROM gab_contacts c WHERE c.subject_id = s.rec_id AND c.tenant_id = ? AND is_primary = true LIMIT 1) as primary_contact
        FROM gab_subjects s
        WHERE s.tenant_id = ?
        ORDER BY s.name ASC
    ");
    $stmt->execute([$tenantId, $tenantId, $tenantId]);
    $res = $stmt->fetchAll(PDO::FETCH_ASSOC);
    print_r($res);
    echo "SUCCESS\n";
} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}
