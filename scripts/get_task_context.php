<?php
// scripts/get_task_context.php
// Helper script for Agents to retrieve formatted task context from DB
// Usage: php scripts/get_task_context.php [TICKET_ID]

require_once __DIR__ . '/../backend/db.php';

if ($argc < 2) {
    die("Usage: php scripts/get_task_context.php [TICKET_ID]\n");
}

$ticketId = $argv[1];

try {
    $pdo = get_db_connection();

    // 1. Get Ticket Info
    // Support ID (int) or REC_ID (int). Assuming rec_id is primary.
    $stmt = $pdo->prepare("SELECT * FROM sys_change_requests WHERE rec_id = ? OR id = ? LIMIT 1");
    $stmt->execute([$ticketId, $ticketId]);
    $ticket = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$ticket) {
        die("❌ Ticket #$ticketId not found.\n");
    }

    $recId = $ticket['rec_id'];
    
    echo "==================================================\n";
    echo "TICKET #{$recId}: {$ticket['subject']}\n";
    echo "Status: {$ticket['status']} | Priority: {$ticket['priority']}\n";
    echo "==================================================\n";
    echo "\n[DESCRIPTION]\n";
    echo $ticket['description'] . "\n\n";

    // 2. Scan Comments for STARRED items
    // If ANY comment contains '⭐' or starts with '*', we prioritize ONLY those.
    // Otherwise, we take all comments NOT starting with '✅'.
    
    // Determining table name (logic from my previous attempt)
    $stmtTables = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    $tables = $stmtTables->fetchAll(PDO::FETCH_COLUMN);
    $commentTable = in_array('sys_change_comments', $tables) ? 'sys_change_comments' : 'sys_discussion';

    $stmtComm = $pdo->prepare("SELECT * FROM $commentTable WHERE cr_id = ? OR record_id = ? ORDER BY created_at ASC");
    $stmtComm->execute([$recId, $recId]);
    $comments = $stmtComm->fetchAll(PDO::FETCH_ASSOC);

    $starredComments = [];
    $normalComments = [];

    foreach ($comments as $c) {
        $body = $c['comment'] ?? $c['body'] ?? '';
        
        // Priority Check
        $isStarred = (mb_strpos($body, '⭐') !== false) || (trim($body)[0] === '*');
        // Resolved Check
        $isResolved = (mb_substr(trim($body), 0, 1) === '✅');

        if ($isStarred) {
            $starredComments[] = $c;
        } elseif (!$isResolved) {
            $normalComments[] = $c;
        }
    }

    echo "[ACTIVE INSTRUCTIONS]\n";

    if (!empty($starredComments)) {
        echo "🚨 PRIORITY OVERRIDE (Star Protocol Active) 🚨\n";
        echo "Only processing starred instructions:\n\n";
        foreach ($starredComments as $c) {
            echo "--- Comment ID {$c['rec_id']} ({$c['created_at']}) ---\n";
            echo ($c['comment'] ?? $c['body']) . "\n\n";
        }
    } else {
        if (empty($normalComments)) {
            echo "No pending instructions found. (All comments resolved or empty).\n";
        } else {
            foreach ($normalComments as $c) {
                echo "--- Comment ID {$c['rec_id']} ({$c['created_at']}) ---\n";
                echo ($c['comment'] ?? $c['body']) . "\n\n";
            }
        }
    }

    // 3. Attachments
    echo "\n[ATTACHMENTS]\n";
    $stmtFiles = $pdo->prepare("SELECT rec_id, file_name, file_size FROM sys_change_requests_files WHERE cr_id = ?");
    $stmtFiles->execute([$recId]);
    $files = $stmtFiles->fetchAll(PDO::FETCH_ASSOC);

    if (empty($files)) {
        echo "No attachments.\n";
    } else {
        foreach ($files as $f) {
            $size = round($f['file_size'] / 1024, 1);
            echo "- ID: {$f['rec_id']} | Name: {$f['file_name']} ({$size} KB)\n";
        }
    }
    
    echo "\n==================================================\n";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}

function get_db_connection() {
    // Basic PDO copy if not available via require
    $host = 'localhost';
    $db = 'shanon_db'; // Default guess if no connection string
    // Better to rely on require_once 'db.php'; which should set $pdo or DB class
    // But since backend/db.php defines DB class, we use that.
    return DB::connect();
}
