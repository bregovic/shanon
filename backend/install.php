<?php
// backend/install.php
// INITIAL SETUP & SEEDING

require_once 'db.php';
require_once 'cors.php';

header("Content-Type: application/json");

// Security Check (simple for now, remove in prod)
// if ($_GET['key'] !== 'SecretInstallKey') die('Unauthorized');

try {
    $pdo = DB::connect();
    $messages = [];

    // 1. Run Migrations (Create Tables)
    // We read the SQL file we created earlier
    $sqlFile = __DIR__ . '/migrations/001_init_core.sql';
    if (file_exists($sqlFile)) {
        $sql = file_get_contents($sqlFile);
        
        // Postgres specific: Split by ';' might fail inside procedures, but for DDL it is fine
        // Better: Execute whole block
        $pdo->exec($sql);
        $messages[] = "Database Schema Imported (Tables Created).";
    } else {
        $messages[] = "Migration file not found (Skipped Schema).";
    }

    // 2. Create Super Admin
    $email = 'admin@test.cz';
    $rawPass = 'Venca123';
    $tenantId = '00000000-0000-0000-0000-000000000000'; // Master Tenant ID
    
    // Check if exists
    $stmt = $pdo->prepare("SELECT rec_id FROM sys_users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        $messages[] = "User $email already exists.";
        
        // Update password just in case (Development convenience)
        $hash = password_hash($rawPass, PASSWORD_DEFAULT);
        $pdo->prepare("UPDATE sys_users SET password_hash = ?, role = 'superadmin' WHERE email = ?")
            ->execute([$hash, $email]);
        $messages[] = "User $email password and role updated.";
        
    } else {
        // Create new
        $hash = password_hash($rawPass, PASSWORD_DEFAULT);
        $sql = "INSERT INTO sys_users (tenant_id, email, password_hash, full_name, role, is_active) 
                VALUES (?, ?, ?, ?, 'superadmin', TRUE)";
        $pdo->prepare($sql)->execute([$tenantId, $email, $hash, 'Super Admin']);
        $messages[] = "User $email created successfully.";
    }

    echo json_encode(['success' => true, 'log' => $messages]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
