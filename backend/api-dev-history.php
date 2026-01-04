<?php
/**
 * API for Development History
 * GET ?action=list - List all history entries
 * POST ?action=add - Add new entry (admin only)
 */
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json; charset=utf-8");

// Auth Check (Optional: Allow read for all logged users, Write for Admin)
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$action = $_REQUEST['action'] ?? 'list';

try {
    $pdo = DB::connect();

    if ($action === 'list') {
        // List all history entries grouped by month (PostgreSQL Syntax)
        $sql = "
            SELECT 
                id, date, title, description, category, related_task_id,
                to_char(date, 'YYYY-MM') as month_key,
                to_char(date, 'Month YYYY') as month_label
            FROM development_history 
            ORDER BY date DESC, id DESC
        ";
        
        $stmt = $pdo->query($sql);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        // Group by month
        $grouped = [];
        foreach ($rows as $row) {
            $key = $row['month_key'];
            if (!isset($grouped[$key])) {
                $grouped[$key] = [
                    'month' => $row['month_label'],
                    'items' => []
                ];
            }
            $grouped[$key]['items'][] = [
                'id' => (int)$row['id'],
                'date' => $row['date'],
                'title' => $row['title'], // Labels handling should be frontend
                'description' => $row['description'],
                'category' => $row['category'],
                'task_id' => $row['related_task_id'] ? (int)$row['related_task_id'] : null
            ];
        }
        
        echo json_encode([
            'success' => true, 
            'data' => array_values($grouped),
            'total' => count($rows)
        ]);
        exit;
    }

    if ($action === 'add') {
        // TODO: Strict Admin check here
        
        $date = $_POST['date'] ?? date('Y-m-d');
        $title = trim($_POST['title'] ?? '');
        $description = trim($_POST['description'] ?? '');
        $category = $_POST['category'] ?? 'feature';
        $taskId = $_POST['task_id'] ?? null;
        
        if (empty($title)) {
            echo json_encode(['success' => false, 'error' => 'Title is required']);
            exit;
        }
        
        $stmt = $pdo->prepare("
            INSERT INTO development_history (date, title, description, category, related_task_id)
            VALUES (?, ?, ?, ?, ?) RETURNING id
        ");
        $stmt->execute([$date, $title, $description, $category, $taskId ?: null]);
        $newId = $stmt->fetchColumn();
        
        echo json_encode(['success' => true, 'id' => $newId]);
        exit;
    }

    echo json_encode(['success' => false, 'error' => 'Unknown action']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
