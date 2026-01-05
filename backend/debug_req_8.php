<?php
require_once 'db.php';
require_once 'cors.php';

echo "<h1>Debug Request 8</h1>";

try {
    $pdo = DB::connect();
    
    // 1. Fetch Request
    $stmt = $pdo->prepare("SELECT * FROM sys_change_requests WHERE rec_id = 8 OR id = 8");
    $stmt->execute();
    $req = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$req) {
        echo "Request 8 not found.<br>";
    } else {
        echo "<h2>Subject: {$req['subject']}</h2>";
        echo "<p>Description: " . nl2br($req['description']) . "</p>";
        echo "<p>Status: {$req['status']}</p>";
    }

    // 2. Fetch Comments
    echo "<h3>Comments</h3>";
    
    // Determine table
    $stmtTables = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    $tables = $stmtTables->fetchAll(PDO::FETCH_COLUMN);
    
    $commentTable = 'sys_change_comments';
    if (!in_array('sys_change_comments', $tables) && in_array('sys_discussion', $tables)) {
        $commentTable = 'sys_discussion';
    }
    
    echo "Using table: $commentTable<br>";
    
    $col = ($commentTable == 'sys_change_comments') ? 'cr_id' : 'record_id';
    
    $stmtC = $pdo->prepare("SELECT * FROM $commentTable WHERE $col = 8 ORDER BY created_at ASC");
    $stmtC->execute();
    $comments = $stmtC->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($comments as $c) {
        $body = $c['comment'] ?? $c['body'] ?? '';
        echo "<div style='border:1px solid #ccc; padding:10px; margin:5px;'>";
        echo "<strong>ID: {$c['rec_id']}</strong><br>";
        echo nl2br($body);
        echo "</div>";
    }

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
