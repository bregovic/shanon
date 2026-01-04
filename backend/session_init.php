<?php
// backend/session_init.php
// Centralized session startup logic

if (session_status() === PHP_SESSION_NONE) {
    // 1. Basic Settings
    ini_set('session.gc_maxlifetime', 604800); // 7 days server-side storage
    ini_set('session.cookie_lifetime', 604800); // 7 days client-side cookie
    
    // 2. Cookie Parameters
    // Determine if we are on HTTPS
    $isHttps = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';
    
    // For Railway/Production Cross-Origin (Frontend Local -> Backend Remote)
    // we need SameSite=None and Secure=true.
    // For Localhost -> Localhost, Lax is fine.
    // We will be permissive here to allow the Local -> Remote workflow.
    
    $cookieParams = [
        'lifetime' => 604800,
        'path' => '/',
        'domain' => '', // Current domain
        'secure' => true, // Force Secure (modern browsers require this for SameSite=None)
        'httponly' => true, // Javascript cannot access cookie
        'samesite' => 'None' // Allow cross-site requests
    ];

    session_set_cookie_params($cookieParams);
    
    // 3. Custom Session Name
    session_name('SHANON_SESSION');
    
    // 4. Start Session
    session_start();
}

// 5. Keep Alive Header
// Send a header to help debug if session is active
if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    header('X-Shanon-Session: Active');
} else {
    header('X-Shanon-Session: Inactive');
}
