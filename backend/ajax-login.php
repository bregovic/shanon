<?php
// backend/ajax-login.php
// Enterprise Secure Login

require_once 'db.php';

header("Access-Control-Allow-Origin: *"); // V produkci omezit na Frontend Domain
header("Access-Control-Allow-Headers: Content-Type");
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
    'secure' => true, // Vyžaduje HTTPS (Railway má HTTPS)
    'httponly' => true, // JS nemůže číst cookie (XSS protection)
    'samesite' => 'Lax'
]);
session_start();

$input = json_decode(file_get_contents('php://input'), true);
$email = trim($input['username'] ?? ''); // Frontend posila 'username', ale my cekame email
$pass = $input['password'] ?? '';

if (!$email || !$pass) {
    returnJson(['error' => 'Zadejte email a heslo.'], 400);
}

try {
    $pdo = DB::connect();

    // 1. Rate Limiting (Simple Sleep)
    // V enterprise verzi by zde byl check do Redis 'login_attempts:ip'
    // Pro teď stačí zpomalení pro prevenci time-timing attacks
    usleep(random_int(200000, 500000)); // 200-500ms delay

    // 2. Fetch User
    // Pouzivame 'sys_users' z core migrace
    $stmt = $pdo->prepare("SELECT * FROM sys_users WHERE email = ? AND is_active = TRUE");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // --- DEV BOOTSTRAP (Pokud neexistuje zadny uzivatel, vytvorime admina) ---
    if (!$user && $email === 'admin@shanon.io' && $pass === 'admin') {
        // Check if DB is truly empty of users
        $count = $pdo->query("SELECT count(*) FROM sys_users")->fetchColumn();
        if ($count == 0) {
            $hash = password_hash('admin', PASSWORD_DEFAULT);
            $tenantId = '00000000-0000-0000-0000-000000000000'; // Default Tenant
            $pdo->prepare("INSERT INTO sys_users (email, password_hash, full_name, role, tenant_id) VALUES (?, ?, ?, ?, ?)")
                ->execute(['admin@shanon.io', $hash, 'System Admin', 'admin', $tenantId]);
            // Re-fetch
            $stmt->execute([$email]);
            $user = $stmt->fetch();
        }
    }
    // -------------------------------------------------------------------------

    // 3. Verify Password
    if ($user && password_verify($pass, $user['password_hash'])) {
        
        // 4. Session Fixation Protection
        session_regenerate_id(true);
        
        // 5. Store Session Data
        $_SESSION['loggedin'] = true;
        $_SESSION['user_id'] = $user['rec_id']; // Shanon Core ID
        $_SESSION['tenant_id'] = $user['tenant_id']; // Multi-tenancy
        $_SESSION['user'] = [
             'id' => $user['rec_id'],
             'name' => $user['full_name'],
             'email' => $user['email'],
             'role' => $user['role'],
             'initials' => strtoupper(substr($user['full_name'] ?? 'User', 0, 2))
        ];

        // 6. Audit Log (Last Login)
        $pdo->prepare("UPDATE sys_users SET last_login = NOW() WHERE rec_id = ?")->execute([$user['rec_id']]);

        returnJson(['success' => true, 'redirect' => '/', 'user' => $_SESSION['user']]);
    } else {
        // Log Failed Attempt
        error_log("Failed login for $email from " . $_SERVER['REMOTE_ADDR']);
        returnJson(['error' => 'Nesprávný email nebo heslo.'], 401);
    }

} catch (Exception $e) {
    error_log($e->getMessage());
    returnJson(['error' => 'Chyba serveru.'], 500);
}
