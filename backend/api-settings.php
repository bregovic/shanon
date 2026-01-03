<?php
// backend/api-settings.php
require_once 'cors.php';
require_once 'db.php'; // In case we add DB logic later

header("Content-Type: application/json");

// Just return default settings for now to prevent 404/500 errors on frontend
// TODO: Implement actual storage in sys_user_settings table
$defaults = [
    'success' => true,
    'settings' => [
        'language' => 'cs', // Default Czech
        'theme' => 'light'
    ]
];

echo json_encode($defaults);
