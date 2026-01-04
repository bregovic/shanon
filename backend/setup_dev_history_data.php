<?php
// backend/setup_dev_history_data.php
require_once 'db.php';

try {
    $pdo = DB::connect();
    
    // Check if empty
    $count = $pdo->query("SELECT COUNT(*) FROM development_history")->fetchColumn();
    
    if ($count == 0) {
        $data = [
            [date('Y-m-d'), 'System Initialization (v1.3.1)', 'Initial migration of Development History module with PostgreSQL support.', 'feature'],
            [date('Y-m-d', strtotime('-1 day')), 'Database Optimization', 'Fixed session persistence issues by implementing DbSessionHandler correctly.', 'bugfix'],
            [date('Y-m-d', strtotime('-2 days')), 'UI Modernization', 'Implemented Fluent UI v9 design system across all major modules.', 'refactor'],
            [date('Y-m-d', strtotime('-3 days')), 'DMS Integration', 'Added fundamental document management system structures.', 'feature'],
            [date('Y-m-d', strtotime('-5 days')), 'Start of Sprint', 'Development kick-off for Q1.', 'improvement']
        ];
        
        $stmt = $pdo->prepare("INSERT INTO development_history (date, title, description, category) VALUES (?, ?, ?, ?)");
        
        foreach ($data as $row) {
            $stmt->execute($row);
        }
        echo json_encode(['success' => true, 'message' => 'Data seeded.']);
    } else {
        echo json_encode(['success' => true, 'message' => 'Data already exists.']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
