<?php
// backend/repair_data.php
// FIXED: Session issue and Tenant Data repair

require_once 'cors.php';
require_once 'db.php';
// We don't require session_init here to strictly block, we want to run this loosely to fix things, 
// BUT for security we should probably rely on the token again or IP. 
// For now, let's use the same token as install-db for safety.

$token = $_GET['token'] ?? '';
if ($token !== 'shanon2026install') {
    die("Unauthorized Repair Access");
}

$pdo = DB::connect();

echo "<h2>Repairing Data...</h2>";

// 1. Fix Missing Tenant IDs in sys_users
// Default Tenant UUID: 00000000-0000-0000-0000-000000000001
$defaultTenant = '00000000-0000-0000-0000-000000000001';

$sql = "UPDATE sys_users SET tenant_id = :def WHERE tenant_id IS NULL OR tenant_id = '' OR tenant_id::text = '0'";
$count = $pdo->prepare($sql)->execute([':def' => $defaultTenant]);
echo "Fixed Users Tenant IDs: $count rows updated.<br>";

// 2. Fix Permissions for mod_orgs
// Ensure object exists
$pdo->exec("INSERT INTO sys_security_objects (identifier, type, display_name, description) VALUES ('mod_orgs', 'module', 'Organizace', 'Správa firemních entit') ON CONFLICT (identifier) DO NOTHING");

// Get IDs
$stmt = $pdo->prepare("SELECT rec_id FROM sys_security_objects WHERE identifier = 'mod_orgs'");
$stmt->execute();
$objId = $stmt->fetchColumn();

$stmt = $pdo->prepare("SELECT rec_id FROM sys_security_roles WHERE code = 'ADMIN'");
$stmt->execute();
$roleId = $stmt->fetchColumn();

if ($objId && $roleId) {
    // Upsert permission
    $sql = "INSERT INTO sys_security_permissions (role_id, object_id, access_level) VALUES ($roleId, $objId, 3) 
            ON CONFLICT (role_id, object_id) DO UPDATE SET access_level = 3";
    $pdo->exec($sql);
    echo "Granted 'mod_orgs' (ID: $objId) to ADMIN (ID: $roleId).<br>";
} else {
    echo "Error finding IDs for permission grant.<br>";
}

// 3. Ensure 'mod_system' access too
$stmt = $pdo->prepare("SELECT rec_id FROM sys_security_objects WHERE identifier = 'mod_system'");
$stmt->execute();
$sysObjId = $stmt->fetchColumn();
if ($sysObjId && $roleId) {
     $pdo->exec("INSERT INTO sys_security_permissions (role_id, object_id, access_level) VALUES ($roleId, $sysObjId, 3) 
            ON CONFLICT (role_id, object_id) DO UPDATE SET access_level = 3");
     echo "Granted 'mod_system' to ADMIN.<br>";
}

echo "<h3>Done. Please allow 10 seconds, then Reload the Page (F5).</h3>";
