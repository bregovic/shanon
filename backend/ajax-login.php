<?php
// backend/ajax-login.php
// Enterprise Secure Login

// Krok 1: Inicializace session přes náš handler.
// DŮLEŽITÉ: Musí být jako první, před hlavičkami a výstupem.
require_once 'cors.php';
require_once 'session_init.php'; 
require_once 'db.php';

header("Content-Type: application/json");

// Helper JSON
function returnJson($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$email = trim($input['username'] ?? ''); 
$pass = $input['password'] ?? '';

if (!$email || !$pass) {
    returnJson(['error' => 'Please enter email and password.'], 400);
}

try {
    $pdo = DB::connect();

    // 1. Rate Limiting (Anti-bruteforce)
    usleep(random_int(100000, 300000));

    // 2. Fetch User
    $stmt = $pdo->prepare("SELECT * FROM sys_users WHERE email = ? AND is_active = TRUE");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // 3. Verify Password
    if ($user && password_verify($pass, $user['password_hash'])) {
        
        // Regenerace ID pro bezpečnost (prevence session fixation)
        // Pozor: U custom handlerů může být nutné zavolat session_write_close() před regenerací, 
        // ale PHP 7.4+ to zvládá dobře.
        session_regenerate_id(true);
        
        // Naplnění session dat
        $_SESSION['loggedin'] = true;
        $_SESSION['user_id'] = $user['rec_id'];
        $_SESSION['tenant_id'] = $user['tenant_id'];
        $_SESSION['user'] = [
             'id' => $user['rec_id'],
             'name' => $user['full_name'],
             'email' => $user['email'],
             'role' => $user['role'],
             'tenant_id' => $user['tenant_id'],
             'initials' => strtoupper(substr($user['full_name'] ?? 'User', 0, 2))
        ];

        // Audit Last Login
        $pdo->prepare("UPDATE sys_users SET last_login = NOW() WHERE rec_id = ?")->execute([$user['rec_id']]);

        // Explicitní uložení session pro jistotu
        session_write_close();

        returnJson(['success' => true, 'redirect' => '/', 'user' => $_SESSION['user']]);
    } else {
        returnJson(['error' => 'Invalid credentials'], 401);
    }

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Server error: ' . $e->getMessage()], 500);
}
