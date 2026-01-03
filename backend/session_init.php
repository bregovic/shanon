<?php
// backend/session_init.php
// Centralized session startup logic

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 86400,
        'path' => '/',
        'secure' => true, // Required for Railway HTTPS
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    session_start();
}
