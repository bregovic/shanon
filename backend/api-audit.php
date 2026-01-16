<?php
require_once 'config.php';
require_once 'db.php';
require_once 'lib_auth.php';

// Only SuperAdmin/Admin access
session_start();
verify_session();
// Mock permission check - strict for now
if ($_SESSION['user_role'] !== 'superadmin' && $_SESSION['user_role'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$action = $_GET['action'] ?? '';
$clientPath = __DIR__ . '/../client/src';
$langPath = __DIR__ . '/../client/public/locales/cs.json';

function getDirContents($dir, &$results = []) {
    $files = scandir($dir);
    foreach ($files as $key => $value) {
        $path = realpath($dir . DIRECTORY_SEPARATOR . $value);
        if (!is_dir($path)) {
            if (pathinfo($path, PATHINFO_EXTENSION) === 'tsx' || pathinfo($path, PATHINFO_EXTENSION) === 'ts') {
                $results[] = $path;
            }
        } else if ($value != "." && $value != "..") {
            getDirContents($path, $results);
        }
    }
    return $results;
}

switch($action) {
    case 'audit_translations':
        $files = getDirContents($clientPath);
        $usedKeys = [];
        $hardcodedCandidates = [];
        
        // Regex patterns
        $tPattern = "/t\(['\"]([^'\"]+)['\"]\)/";
        // Simple hardcoded detection: Text between > and < that doesn't look like code
        // This is heuristic and noisy, but helpful.
        $hardcodedPattern = "/>\s*([A-Za-zěščřžýáíéúůĚŠČŘŽÝÁÍÉÚŮ0-9\s,.!?-]+)\s*</";

        foreach ($files as $file) {
            $content = file_get_contents($file);
            $relPath = str_replace(realpath($clientPath) . DIRECTORY_SEPARATOR, '', $file);

            // Find t('key')
            if (preg_match_all($tPattern, $content, $matches)) {
                foreach ($matches[1] as $key) {
                    $usedKeys[$key][] = $relPath;
                }
            }

            // Find candidates for hardcoded strings
            // Ignoring common short strings or numbers
            if (preg_match_all($hardcodedPattern, $content, $matches)) {
                foreach ($matches[1] as $text) {
                    $text = trim($text);
                    if (strlen($text) > 2 && !is_numeric($text)) {
                        $hardcodedCandidates[] = [
                            'file' => $relPath,
                            'text' => $text
                        ];
                    }
                }
            }
        }

        // Load correct definitions
        $jsonContent = file_get_contents($langPath);
        $definedKeysFlat = [];
        
        function flatten($array, $prefix = '') {
            $result = [];
            foreach ($array as $key => $value) {
                if (is_array($value)) {
                    $result = $result + flatten($value, $prefix . $key . '.');
                } else {
                    $result[$prefix . $key] = $value;
                }
            }
            return $result;
        }

        $jsonArr = json_decode($jsonContent, true);
        $definedMap = flatten($jsonArr);
        $definedKeys = array_keys($definedMap);

        // Analysis
        $missing = []; // Used but not in JSON
        foreach ($usedKeys as $key => $files) {
            if (!in_array($key, $definedKeys)) {
                $missing[] = ['key' => $key, 'files' => array_unique($files)];
            }
        }

        $unused = []; // In JSON but not used
        // We need to be careful with dynamic keys (e.g. `status.${status}`), exact match might fail.
        // For now, listing exact mismatches.
        foreach ($definedKeys as $key) {
            if (!array_key_exists($key, $usedKeys)) {
                // Heuristic: check if key part exists in used keys (dynamic usage)
                $isDynamic = false;
                /* foreach(array_keys($usedKeys) as $uk) {
                     if (strpos($uk, '${') !== false) { ... }
                } */
                $unused[] = ['key' => $key, 'value' => $definedMap[$key]];
            }
        }

        echo json_encode([
            'success' => true,
            'scanned_count' => count($files),
            'missing_translations' => $missing,
            'unused_translations' => $unused,
            'hardcoded_candidates' => array_slice($hardcodedCandidates, 0, 100) // Limit response
        ]);
        break;

    default:
        echo json_encode(['error' => 'Invalid action']);
        break;
}
