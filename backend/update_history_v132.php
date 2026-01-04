<?php
require_once 'db.php';

try {
    $pdo = DB::connect();
    
    $entries = [
        [
            date('Y-m-d'), 
            'UI Standardization (Requests & Dashboard)', 
            'Refactored Requests Form and Dashboard to meet new UI Standard (Two-Bar Layout, Mobile Scroll, Menu Hierarchy). Fixed variable declaration bugs.', 
            'refactor'
        ],
        [
            date('Y-m-d'),
            'Fix: RequestsPage Build',
            'Fixed duplicate variable declarations in RequestsPage.tsx preventing build.',
            'bugfix'
        ]
    ];

    $stmt = $pdo->prepare("INSERT INTO development_history (date, title, description, category) VALUES (?, ?, ?, ?)");
    
    foreach ($entries as $row) {
        $stmt->execute($row);
    }
    
    echo "History updated v1.3.2\n";
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
?>
