<?php
// backend/ajax-login.php
// Enterprise Secure Login

require_once 'db.php';
require_once 'cors.php'; // Use centralized CORS logic

header("Content-Type: application/json");

// Helper JSON
function returnJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// Start Session Bezpečně
session_set_cookie_params([
    'lifetime' => 86400,
    'path' => '/',
    'secure' => true, 
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

$input = json_decode(file_get_contents('php://input'), true);
$email = trim($input['username'] ?? ''); 
$pass = $input['password'] ?? '';

if (!$email || !$pass) {
    returnJson(['error' => 'Please enter email and password.'], 400);
}

try {
    $pdo = DB::connect();

    // 1. Rate Limiting
    usleep(random_int(100000, 300000));

    // 2. Fetch User
    $stmt = $pdo->prepare("SELECT * FROM sys_users WHERE email = ? AND is_active = TRUE");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // 3. Verify Password
    if ($user && password_verify($pass, $user['password_hash'])) {
        
        session_regenerate_id(true);
        
        $_SESSION['loggedin'] = true;
        $_SESSION['user_id'] = $user['rec_id'];
        $_SESSION['tenant_id'] = $user['tenant_id'];
        $_SESSION['user'] = [
             'id' => $user['rec_id'],
             'name' => $user['full_name'],
             'email' => $user['email'],
             'role' => $user['role'],
             'initials' => strtoupper(substr($user['full_name'] ?? 'User', 0, 2))
        ];

        // Audit Last Login
        $pdo->prepare("UPDATE sys_users SET last_login = NOW() WHERE rec_id = ?")->execute([$user['rec_id']]);

        returnJson(['success' => true, 'redirect' => '/', 'user' => $_SESSION['user']]);
    } else {
        // --- DEBUG START (Remove in Prod) ---
        // Vracime info proc to nejde
        $debug = [];
        if (!$user) {
            $debug['reason'] = 'User not found in Postgres DB';
        } else {
            $debug['reason'] = 'Password hash mismatch';
            // $debug['db_hash'] = substr($user['password_hash'], 0, 10) . '...';
        }
        // --- DEBUG END ---

        returnJson(['error' => 'Invalid credentials', 'debug' => $debug], 401);
    }

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server error: ' . $e->getMessage()], 500);
}
