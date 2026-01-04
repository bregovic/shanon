<?php
// backend/session_init.php
// Centralized session startup logic

if (session_status() === PHP_SESSION_NONE) {
    // Session cookie valid for 7 days
    $lifetime = 7 * 24 * 60 * 60; // 604800 seconds
    
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path' => '/',
        'domain' => '', // Current domain
        'secure' => true, // Required for Railway HTTPS
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    
    // Custom session name for Shanon
    session_name('SHANON_SESSION');
    
    // Start session
    session_start();
    
    // Extend session lifetime on every request
    if (isset($_SESSION['loggedin'])) {
        // Regenerate session ID periodically for security (every 30 minutes)
        if (!isset($_SESSION['last_regeneration'])) {
            $_SESSION['last_regeneration'] = time();
        } elseif (time() - $_SESSION['last_regeneration'] > 1800) {
            session_regenerate_id(true);
            $_SESSION['last_regeneration'] = time();
        }
        
        // Update cookie expiry
        setcookie(session_name(), session_id(), [
            'expires' => time() + $lifetime,
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Lax'
        ]);
    }
}
