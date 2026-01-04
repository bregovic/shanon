<?php
require_once 'cors.php';
require_once 'db.php';

try {
    $pdo = DB::connect();
    $ticketId = 7;
    $agentSignature = "🤖";

    $sql = "SELECT rec_id, comment FROM sys_change_comments 
            WHERE cr_id = ? 
            AND comment NOT LIKE '✅%' 
            AND comment NOT LIKE '%$agentSignature%'";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([$ticketId]);
    $comments = $stmt->fetchAll();

    echo "Found " . count($comments) . " unresolved comments.\n";

    foreach ($comments as $c) {
        $newBody = "✅ " . $c['comment'];
        $pdo->prepare("UPDATE sys_change_comments SET comment = ? WHERE rec_id = ?")->execute([$newBody, $c['rec_id']]);
        echo "Fixed comment {$c['rec_id']}.\n";
    }
    
    echo "Done.";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
