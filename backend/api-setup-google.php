<?php
// backend/setup-google.php
// Jednoduchý nástroj pro získání OAuth 2.0 Refresh Tokenu pro Shanon DMS

session_start();

$step = $_GET['step'] ?? 1;
$selfUrl = 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['PHP_SELF'];

// 1. ZPRACOVÁNÍ NÁVRATU Z GOOGLE (KROK 2 -> 3)
if (isset($_GET['code'])) {
    $code = $_GET['code'];
    $clientId = $_SESSION['google_client_id'] ?? '';
    $clientSecret = $_SESSION['google_client_secret'] ?? '';

    if (!$clientId || !$clientSecret) {
        die('Chyba: Ztratila se session. Začněte znovu.');
    }

    // Výměna kódu za token
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://oauth2.googleapis.com/token');
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'code' => $code,
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'redirect_uri' => $selfUrl,
        'grant_type' => 'authorization_code'
    ]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $response = curl_exec($ch);
    curl_close($ch);

    $data = json_decode($response, true);
    
    if (isset($data['error'])) {
        die('Chyba při získávání tokenu: ' . ($data['error_description'] ?? $data['error']));
    }

    $refreshToken = $data['refresh_token'] ?? null;

    if (!$refreshToken) {
        die('Chyba: Google nevrátil Refresh Token. Možná jste aplikaci již dříve autorizovali. Zkuste odebrat oprávnění v Google Account -> Security -> Third-party apps a zkuste to znovu.');
    }

    // Výsledný JSON pro Shanon
    $finalJson = json_encode([
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'refresh_token' => $refreshToken
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

    echo "<h1>✅ Hotovo!</h1>";
    echo "<p>Tento kód zkopírujte a vložte do Shanonu (Nastavení -> Úložiště -> Google Drive -> Connection String):</p>";
    echo "<textarea style='width:100%; height: 200px; font-family:monospace;'>" . $finalJson . "</textarea>";
    echo "<p><i>Poznámka: Tento kód obsahuje klíč k vašemu disku, nikomu ho neposílejte!</i></p>";
    exit;
}

// 2. FORMULÁŘ (KROK 1)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $_SESSION['google_client_id'] = $_POST['client_id'];
    $_SESSION['google_client_secret'] = $_POST['client_secret'];

    $authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" . http_build_query([
        'scope' => 'https://www.googleapis.com/auth/drive',
        'access_type' => 'offline', // Důležité pro získání Refresh tokenu
        'include_granted_scopes' => 'true',
        'response_type' => 'code',
        'prompt' => 'consent', // Vynutí obrazovku souhlasu (aby vrátil refresh token)
        'redirect_uri' => $selfUrl,
        'client_id' => $_POST['client_id']
    ]);

    header("Location: $authUrl");
    exit;
}
?>

<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <title>Nastavení Google Drive pro Shanon</title>
    <style>
        body { font-family: sans-serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 20px; }
        input[type="text"] { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
        button { padding: 10px 20px; background: #0078d4; color: white; border: none; cursor: pointer; font-size: 16px; }
        code { background: #f0f0f0; padding: 2px 5px; }
        .alert { background: #fff3cd; color: #856404; padding: 15px; margin-bottom: 20px; border: 1px solid #ffeeba; }
    </style>
</head>
<body>
    <h1>Nastavení Google Drive (OAuth 2.0)</h1>
    <p>Tento nástroj vám pomůže vygenerovat přístupový kód pro Shanon aplikaci, aby mohla nahrávat soubory na váš osobní Google Disk.</p>

    <div class="alert">
        <strong>⚠️ Důležité:</strong> Než začnete, musíte v <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a> přidat tuto adresu do "Authorized redirect URIs":
        <br><br>
        <code><?php echo $selfUrl; ?></code>
    </div>

    <form method="post">
        <label><strong>Client ID</strong> (z Google Console):</label>
        <input type="text" name="client_id" required placeholder="např. 123456...apps.googleusercontent.com">

        <label><strong>Client Secret</strong> (z Google Console):</label>
        <input type="text" name="client_secret" required placeholder="např. GOCSPX-...">

        <button type="submit">Přihlásit se přes Google</button>
    </form>
</body>
</html>
