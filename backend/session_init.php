<?php
// backend/session_init.php
// Centralized session startup logic

if (session_status() === PHP_SESSION_NONE) {
    // Session cookie valid for 7 days
    $lifetime = 7 * 24 * 60 * 60; // 604800 seconds
    
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path' => '/',
        'domain' => '',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'None' // Changed to None for cross-origin
    ]);
    
    session_name('SHANON_SESSION');
    session_start();
}
