<?php
// backend/ajax-get-user.php
require_once 'cors.php'; 
require_once 'session_init.php';

header("Content-Type: application/json");

if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    echo json_encode([
        'success' => true,
        'is_logged_in' => true,
        'user' => $_SESSION['user'] ?? null
    ]);
} else {
    echo json_encode(['success' => false, 'is_logged_in' => false]);
}
