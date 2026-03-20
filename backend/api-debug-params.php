<?php
// backend/api-debug-params.php
require_once 'db.php';
header("Content-Type: application/json");

try {
    $db = DB::connect();
    $stmt = $db->query("SELECT * FROM sys_parameters");
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
