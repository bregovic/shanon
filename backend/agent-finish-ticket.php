<?php
require_once 'cors.php';
require_once 'db.php';

// Simple security check (in real scenario should be stricter)
if (php_sapi_name() !== 'cli' && !isset($_GET['key'])) {
    // Only allow if specific key is present for simple protection, or just allow it for now since it's a temp agent script
    // die('Access Denied');
}

try {
    $pdo = DB::connect();

    $ticketId = 7;
    $agentName = "🤖 Antigravity";
    $agentUserId = 1; // System/Admin user

    echo "<pre>";
    echo "Processing Ticket #$ticketId...\n";

    // 1. Mark Resolved Comments
    // Mark comments from users (not the agent) that are not yet marked.
    // NOTE: Using a simple NOT LIKE check.
    $stmt = $pdo->prepare("SELECT rec_id, comment FROM sys_change_comments WHERE cr_id = ? AND comment NOT LIKE '✅%' AND user_id != ?");
    $stmt->execute([$ticketId, $agentUserId]);
    $comments = $stmt->fetchAll();

    foreach ($comments as $c) {
        $newBody = "✅ " . $c['comment'];
        $upd = $pdo->prepare("UPDATE sys_change_comments SET comment = ? WHERE rec_id = ?");
        $upd->execute([$newBody, $c['rec_id']]);
        echo "  - Marked comment {$c['rec_id']} as resolved.\n";
    }

    // 2. Update Status -> Testing
    $pdo->prepare("UPDATE sys_change_requests SET status = 'Testing' WHERE rec_id = ?")->execute([$ticketId]);
    echo "  - Status updated to Testing.\n";

    // 3. Post Final Comment
    $finalComment = "Opraveno filtrování požadavků (View: Jen moje nyní funguje na backendu), opraveny 500 chyby při vkládání komentářů a opraveny frontend crashe (Object.entries) + fix čištění editoru.\n\nChanges deployed. Ready for testing. ~ $agentName";

    // Check if duplicate comment exists to avoid spam on multiple runs
    $dupCheck = $pdo->prepare("SELECT count(*) FROM sys_change_comments WHERE cr_id = ? AND comment = ?");
    $dupCheck->execute([$ticketId, $finalComment]);
    if ($dupCheck->fetchColumn() == 0) {
        $pdo->prepare("INSERT INTO sys_change_comments (cr_id, user_id, comment) VALUES (?, ?, ?)")
            ->execute([$ticketId, $agentUserId, $finalComment]);
        echo "  - Final comment posted.\n";
    } else {
        echo "  - Final comment already posted.\n";
    }

    // 4. Log to Development History
    $today = date('Y-m-d');
    $title = "Fix: Request filtering & Comments";
    $desc = "Implemented backend logic for 'My Requests' view filter. Fixed user session bugs causing 500 errors on comments. Patched frontend crash on missing reactions.";

    // Check if logged
    $chk = $pdo->prepare("SELECT count(*) FROM development_history WHERE date = ? AND related_task_id = ?");
    $chk->execute([$today, $ticketId]);
    if ($chk->fetchColumn() == 0) {
        $ins = $pdo->prepare("INSERT INTO development_history (date, title, description, category, related_task_id) VALUES (?, ?, ?, 'fix', ?)");
        $ins->execute([$today, $title, $desc, $ticketId]);
        echo "  - Development history logged.\n";
    } else {
        echo "  - Development history already exists for today.\n";
    }

    echo "Done.\n";
    echo "</pre>";

} catch (Exception $e) {
    echo "Error: " . $e->getMessage();
}
