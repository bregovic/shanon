<?php
// backend/agent_finalize_task.php
// Helper to finalize Ticket #8 according to Manifest protocols

require_once 'db.php';
require_once 'cors.php';

echo "<h1>Finalizing Ticket #8</h1>";

$ticketId = 8;
$agentName = "🤖 Antigravity";
$commentBody = "Changes deployed based on priority instructions (⭐):\n- Removed Number Series from Settings.\n- Added ID column to DMS List.\n- Standardized Settings UI.\n\nReady for testing.\n~ " . $agentName;
$historyTitle = "DMS Settings Refactor [REQ-8]";
$historyDesc = "Removed legacy Number Series, standardized UI, added ID column to list.";
$historyCat = "DMS";

try {
    $pdo = DB::connect();

    // 1. Update Status to 'Testing'
    echo "Updating Status... ";
    $stmt = $pdo->prepare("UPDATE sys_change_requests SET status = 'Testing' WHERE rec_id = ?");
    $stmt->execute([$ticketId]);
    echo "Done.<br>";

    // 2. Add Comment
    echo "Adding Comment... ";
    // Use the correct table based on previous checks, but assuming sys_change_comments is standard now
    // If sys_change_comments doesn't exist, we might fail, but let's assume it does as per AGENT_WORKFLOW
    // We need to check columns: cr_id, user_id, comment vs record_id, user_id, body ?
    // Based on `api-changerequests.php` line 493: `INSERT INTO sys_change_comments (cr_id, user_id, comment)`
    // User ID for Agent? Let's use 1 (Admin) or look for 'AI Developer'.
    $userId = 1; // Default fallback
    
    // Check if sys_users has AI user
    $stmtU = $pdo->query("SELECT rec_id FROM sys_users WHERE email = 'ai@shanon.dev'");
    $aiUser = $stmtU->fetchColumn();
    if ($aiUser) $userId = $aiUser;

    $stmtC = $pdo->prepare("INSERT INTO sys_change_comments (cr_id, user_id, comment) VALUES (?, ?, ?)");
    $stmtC->execute([$ticketId, $userId, $commentBody]);
    echo "Done.<br>";

    // 3. Log Development History
    echo "Logging History... ";
    // Table: development_history (date, title, description, category, created_at)
    $stmtH = $pdo->prepare("INSERT INTO development_history (date, title, description, category, created_at) VALUES (CURRENT_DATE, ?, ?, ?, NOW())");
    $stmtH->execute([$historyTitle, $historyDesc, $historyCat]);
    echo "Done.<br>";

    echo "<h3>SUCCESS: Ticket #8 Finalized.</h3>";

} catch (Exception $e) {
    echo "<h3>ERROR: " . $e->getMessage() . "</h3>";
}
