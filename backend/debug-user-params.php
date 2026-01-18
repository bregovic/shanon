<?php
// Debug script for sys_user_params table
require_once 'db.php';

header("Content-Type: application/json");

try {
    $pdo = DB::connect();
    
    // Check if table exists
    $tableExists = $pdo->query("SELECT to_regclass('sys_user_params')")->fetchColumn();
    
    if (!$tableExists) {
        echo json_encode(['success' => false, 'error' => 'Table does not exist']);
        exit;
    }
    
    // Get table schema
    $schemaStmt = $pdo->query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'sys_user_params' ORDER BY ordinal_position");
    $schema = $schemaStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Get all entries
    $entriesStmt = $pdo->query("SELECT * FROM sys_user_params ORDER BY param_key LIMIT 50");
    $entries = $entriesStmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode([
        'success' => true,
        'schema' => $schema,
        'entries' => $entries,
        'count' => count($entries)
    ], JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
