<?php
// backend/debug-session.php
require_once 'session_init.php';

echo "<h1>Session Debug</h1>";
echo "Session ID: " . session_id() . "<br>";
echo "Save Handler: " . ini_get('session.save_handler') . "<br>";

echo "<h2>\$_SESSION Content:</h2>";
echo "<pre>";
print_r($_SESSION);
echo "</pre>";

// Test write
$_SESSION['debug_timestamp'] = time();
echo "Updated timestamp in session.<br>";

// Check DB directly
echo "<h2>DB Content for this ID:</h2>";
try {
    $pdo = DB::connect();
    $stmt = $pdo->prepare("SELECT * FROM sys_sessions WHERE id = :id");
    $stmt->execute([':id' => session_id()]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        echo "Found in DB!<br>";
        echo "Data length: " . strlen($row['data']) . "<br>";
        echo "Raw data: " . htmlspecialchars($row['data']) . "<br>";
    } else {
        echo "<strong style='color:red'>NOT FOUND IN DB!</strong><br>";
    }
} catch (Exception $e) {
    echo "DB Error: " . $e->getMessage();
}
