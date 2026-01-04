<?php
// backend/session_init.php
// Centralized session startup logic with Database Storage

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/DbSessionHandler.php';

if (session_status() === PHP_SESSION_NONE) {
    // 1. Basic Settings
    ini_set('session.gc_maxlifetime', 604800); // 7 days
    ini_set('session.cookie_lifetime', 604800); // 7 days
    
    // 2. Cookie Parameters
    session_set_cookie_params([
        'lifetime' => 604800,
        'path' => '/',
        'domain' => '', 
        'secure' => true,
        'httponly' => true,
        'samesite' => 'None'
    ]);
    
    // 3. Custom Session Name
    session_name('SHANON_SESSION');

    // 4. Set Database Handler
    try {
        // We reuse the existing DB connection logic
        $pdo = DB::connect();
        $handler = new DbSessionHandler($pdo);
        session_set_save_handler($handler, true);
    } catch (Exception $e) {
        // Fallback to files if DB fails (should alert admin/logs)
        error_log("Session DB connection failed: " . $e->getMessage());
        // Standard file handler checks will apply
    }
    
    // 5. Start Session
    session_start();
}

// Keep Alive Header
if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    header('X-Shanon-Session: Active');
    header('X-Shanon-Storage: Database');
} else {
    header('X-Shanon-Session: Inactive');
}
