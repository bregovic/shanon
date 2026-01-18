<?php
// Debug script for org assignment issues
require_once 'db.php';

header("Content-Type: application/json");

try {
    $pdo = DB::connect();
    
    // Get all user org access entries
    $accessStmt = $pdo->query("SELECT * FROM sys_user_org_access ORDER BY user_id, org_id");
    $allAccess = $accessStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Get table structure
    $schemaStmt = $pdo->query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sys_user_org_access' ORDER BY ordinal_position");
    $schema = $schemaStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Get constraint info
    $constraintStmt = $pdo->query("SELECT conname, pg_get_constraintdef(oid) as definition FROM pg_constraint WHERE conrelid = 'sys_user_org_access'::regclass");
    $constraints = $constraintStmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode([
        'success' => true,
        'schema' => $schema,
        'constraints' => $constraints,
        'entries' => $allAccess,
        'count' => count($allAccess)
    ], JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
