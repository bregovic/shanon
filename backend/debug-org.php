<?php
// backend/debug-org.php - Temporary debug endpoint for Multi-Org
// DELETE THIS FILE AFTER DEBUGGING
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

$debug = [];
$debug['session_loggedin'] = $_SESSION['loggedin'] ?? false;
$debug['session_user'] = $_SESSION['user'] ?? null;
$debug['session_current_org'] = $_SESSION['current_org_id'] ?? null;

try {
    $pdo = DB::connect();
    $debug['db_connected'] = true;
    
    // Check if tables exist
    $debug['sys_organizations_exists'] = (bool)$pdo->query("SELECT to_regclass('sys_organizations')")->fetchColumn();
    $debug['sys_user_org_access_exists'] = (bool)$pdo->query("SELECT to_regclass('sys_user_org_access')")->fetchColumn();
    
    // Count records
    if ($debug['sys_organizations_exists']) {
        $debug['org_count'] = $pdo->query("SELECT COUNT(*) FROM sys_organizations")->fetchColumn();
        $debug['orgs'] = $pdo->query("SELECT * FROM sys_organizations")->fetchAll(PDO::FETCH_ASSOC);
    }
    
    if ($debug['sys_user_org_access_exists']) {
        $debug['access_count'] = $pdo->query("SELECT COUNT(*) FROM sys_user_org_access")->fetchColumn();
        $debug['access_entries'] = $pdo->query("SELECT * FROM sys_user_org_access LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
    }
    
    // Test the actual query
    if (isset($_SESSION['user']['rec_id'])) {
        $uid = $_SESSION['user']['rec_id'];
        $stmt = $pdo->prepare("
            SELECT o.org_id, o.display_name, a.is_default
            FROM sys_user_org_access a
            JOIN sys_organizations o ON a.org_id = o.org_id
            WHERE a.user_id = :uid AND o.is_active = true
        ");
        $stmt->execute([':uid' => $uid]);
        $debug['user_orgs_query_result'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Fallback query
        $stmt2 = $pdo->query("SELECT org_id, display_name FROM sys_organizations WHERE is_active = true LIMIT 1");
        $debug['fallback_org'] = $stmt2->fetch(PDO::FETCH_ASSOC);
    }
    
} catch (Exception $e) {
    $debug['db_error'] = $e->getMessage();
}

echo json_encode($debug, JSON_PRETTY_PRINT);
