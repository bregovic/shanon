<?php
// Ensure JSON response even on fatal errors
header('Content-Type: application/json');

try {
    require_once 'config.php';
    require_once 'db.php';
    require_once 'lib_auth.php';

    // Only SuperAdmin/Admin access
    if (session_status() === PHP_SESSION_NONE) session_start();
    verify_session();

    if (($_SESSION['user_role'] ?? '') !== 'superadmin' && ($_SESSION['user_role'] ?? '') !== 'admin') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Unauthorized']);
        exit;
    }

    $action = $_GET['action'] ?? '';
    // Path relative to api-audit.php (backend folder) -> client/src
    $clientPath = __DIR__ . '/../client/src'; 
    $translationFile = __DIR__ . '/../client/src/locales/translations.ts'; // Updated check for TS file

    function getDirContents($dir, &$results = []) {
        if (!is_dir($dir)) return [];
        
        $files = scandir($dir);
        foreach ($files as $value) {
            if ($value === '.' || $value === '..') continue;
            
            $path = realpath($dir . DIRECTORY_SEPARATOR . $value);
            if (!$path) continue;

            if (!is_dir($path)) {
                $ext = pathinfo($path, PATHINFO_EXTENSION);
                if ($ext === 'tsx' || $ext === 'ts') {
                    $results[] = $path;
                }
            } else {
                getDirContents($path, $results);
            }
        }
        return $results;
    }

    if ($action === 'audit_translations') {
        // 1. Safety Check: Does source exist?
        if (!is_dir($clientPath)) {
            echo json_encode([
                'success' => true,
                'scanned_count' => 0,
                'missing_translations' => [],
                'unused_translations' => [],
                'hardcoded_candidates' => []
            ]);
            exit;
        }

        // 2. Scan Files
        $files = getDirContents($clientPath);
        $scannedCount = count($files);
        
        $usedKeys = [];
        $hardcodedCandidates = [];
        $tPattern = "/[^a-zA-Z]t\(['\"]([^'\"]+)['\"]\)/"; // Matches t('key') or {t('key')}
        $hardcodedPattern = "/>\s*([A-Za-zěščřžýáíéúůĚŠČŘŽÝÁÍÉÚŮ0-9\s,.!?-]+)\s*</";

        foreach ($files as $file) {
            $content = file_get_contents($file);
            $relPath = str_replace(realpath($clientPath) . DIRECTORY_SEPARATOR, '', $file);

            if (preg_match_all($tPattern, $content, $matches)) {
                foreach ($matches[1] as $key) {
                    $usedKeys[$key][] = $relPath;
                }
            }
            
            // Heuristic hardcoded check
            if (preg_match_all($hardcodedPattern, $content, $matches)) {
                foreach ($matches[1] as $text) {
                    $text = trim($text);
                    if (strlen($text) > 3 && !is_numeric($text) && strpos($text, '{') === false) {
                         $hardcodedCandidates[] = ['file' => $relPath, 'text' => $text];
                    }
                }
            }
        }

        // 3. Load Definitions (Naive regex parse of TS file since we can't run TS in PHP)
        // We look for 'key': 'value' or key: 'value' inside the file
        $definedKeys = [];
        if (file_exists($translationFile)) {
            $tsContent = file_get_contents($translationFile);
            // Matches "key": "value" or 'key': 'value' or key: 'value'
            // This is a rough approximation for audit purposes
            if (preg_match_all("/['\"]?([a-zA-Z0-9_.]+)['\"]?\s*:\s*['\"`]/", $tsContent, $matches)) {
                $definedKeys = $matches[1];
            }
        }

        // 4. Analyze
        $missing = [];
        foreach ($usedKeys as $key => $fList) {
            if (!in_array($key, $definedKeys)) {
                $missing[] = ['key' => $key, 'files' => array_unique($fList)];
            }
        }

        $unused = [];
        // Optional: Check unused

        echo json_encode([
            'success' => true,
            'scanned_count' => $scannedCount,
            'missing_translations' => $missing,
            'unused_translations' => $unused,
            'hardcoded_candidates' => array_slice($hardcodedCandidates, 0, 100)
        ]);
        exit;
    }

    echo json_encode(['error' => 'Invalid action']);

} catch (Throwable $e) {
    http_response_code(200); // Return 200 with error field to handle it gracefully in frontend
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
