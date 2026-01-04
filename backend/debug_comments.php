<?php
require_once 'cors.php';
require_once 'db.php';

try {
    $pdo = DB::connect();
    $stmt = $pdo->prepare("
        SELECT c.rec_id, c.comment, c.created_at, u.full_name, c.user_id 
        FROM sys_change_comments c
        LEFT JOIN sys_users u ON c.user_id = u.rec_id
        WHERE c.cr_id = 7 
        ORDER BY c.created_at ASC
    ");
    $stmt->execute();
    $comments = $stmt->fetchAll(PDO::FETCH_ASSOC);

    header('Content-Type: application/json');
    echo json_encode($comments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
