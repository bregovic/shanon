<?php
require_once 'cors.php';
require_once 'db.php';

try {
    $pdo = DB::connect();

    $aiEmail = 'ai@shanon.dev';
    $ticketId = 7;

    // 1. Ensure AI User Exists
    $stmt = $pdo->prepare("SELECT rec_id FROM sys_users WHERE email = ?");
    $stmt->execute([$aiEmail]);
    $aiId = $stmt->fetchColumn();

    if (!$aiId) {
        echo "Creating AI User...\n";
        // REMOVED 'username' column as it does not exist in schema. Using full_name.
        $sql = "INSERT INTO sys_users (tenant_id, full_name, email, password_hash, role, created_at)
                VALUES ('00000000-0000-0000-0000-000000000001', 'AI Developer', ?, 'DISABLED', 'admin', NOW())
                RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$aiEmail]);
        $aiId = $stmt->fetchColumn();
        echo "Created AI User ID: $aiId\n";
    } else {
        echo "AI User exists. ID: $aiId\n";
    }

    // 2. Assign Agent Comments to AI User
    $sql = "UPDATE sys_change_comments 
            SET user_id = ? 
            WHERE comment LIKE '%🤖%' AND user_id != ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$aiId, $aiId]);
    $count = $stmt->rowCount();
    echo "Reassigned $count agent comments to AI Developer.\n";

    // 3. Mark User Comments as Resolved
    $sql = "SELECT rec_id, comment FROM sys_change_comments 
            WHERE cr_id = ? 
            AND user_id != ? 
            AND comment NOT LIKE '✅%' 
            AND comment NOT LIKE '%🤖%'";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$ticketId, $aiId]);
    $comments = $stmt->fetchAll();

    foreach ($comments as $c) {
        $newBody = "✅ " . $c['comment'];
        $pdo->prepare("UPDATE sys_change_comments SET comment = ? WHERE rec_id = ?")->execute([$newBody, $c['rec_id']]);
        echo "Marked user comment {$c['rec_id']} as resolved.\n";
    }

    echo "Identity Fix & Cleanup Done.";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
