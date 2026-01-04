<?php
// backend/ajax-get-user.php
require_once 'cors.php'; 
require_once 'session_init.php';

// PERFORMANCE FIX: 
// Okamžitě uzavřít session pro zápis. Tím uvolníme zámek pro ostatní skripty (jako login nebo další requesty).
// Protože zde session data jen ČTEME a neměníme, je to bezpečné a výrazně to zrychlí souběžné požadavky.
session_write_close();

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
