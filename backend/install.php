<?php
// backend/install.php
// INITIAL SETUP & SEEDING

require_once 'db.php';
require_once 'cors.php';

header("Content-Type: application/json");

try {
    $pdo = DB::connect();
    $messages = [];

    // 1. Run Migrations
    $sqlFile = __DIR__ . '/migrations/001_init_core.sql';
    
    if (!file_exists($sqlFile)) {
        throw new Exception("CRITICAL: Migration file not found at: " . $sqlFile); // Stop execution
    }

    $sql = file_get_contents($sqlFile);
    if (!$sql) {
        throw new Exception("CRITICAL: Migration file is empty: " . $sqlFile);
    }
    
    // Execute SQL Schema
    try {
        $pdo->exec($sql);
        $messages[] = "Database Schema Imported Successfully.";
    } catch (PDOException $e) {
        // Ignorovat chybu "relation already exists" pokud spoustime podruhe
        if (strpos($e->getMessage(), 'already exists') !== false) {
             $messages[] = "Schema already exists (Skipped).";
        } else {
             throw $e;
        }
    }

    // 2. Create Super Admin
    $email = 'admin@test.cz';
    $rawPass = 'Venca123';
    $tenantId = '00000000-0000-0000-0000-000000000000'; 
    
    // Check if table exists (simple check)
    // Postgres specific check
    $checkTable = $pdo->query("SELECT to_regclass('public.sys_users')")->fetchColumn();
    if (!$checkTable) {
        throw new Exception("Table 'sys_users' was not created even after migration run!");
    }

    // Check user
    $stmt = $pdo->prepare("SELECT rec_id FROM sys_users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        $messages[] = "User $email already exists.";
        // Update to be sure
        $hash = password_hash($rawPass, PASSWORD_DEFAULT);
        $pdo->prepare("UPDATE sys_users SET password_hash = ?, role = 'superadmin' WHERE email = ?")
            ->execute([$hash, $email]);
    } else {
        $hash = password_hash($rawPass, PASSWORD_DEFAULT);
        $sqlInsert = "INSERT INTO sys_users (tenant_id, email, password_hash, full_name, role, is_active) 
                      VALUES (?, ?, ?, ?, 'superadmin', TRUE)";
        $pdo->prepare($sqlInsert)->execute([$tenantId, $email, $hash, 'Super Admin']);
        $messages[] = "User $email created successfully.";
    }

    echo json_encode(['success' => true, 'log' => $messages]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ]);
}
