<?php
// backend/ajax-get-user.php
require_once 'cors.php'; // Handle CORS if separated

session_start();

header("Content-Type: application/json");

if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    echo json_encode([
        'is_logged_in' => true,
        'user' => $_SESSION['user'] ?? null
    ]);
} else {
    echo json_encode(['is_logged_in' => false]);
}
